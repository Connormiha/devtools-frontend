/*
 * Copyright (C) 2012 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

// See http://www.softwareishard.com/blog/har-12-spec/
// for HAR specification.

// FIXME: Some fields are not yet supported due to back-end limitations.
// See https://bugs.webkit.org/show_bug.cgi?id=58127 for details.

/* eslint-disable rulesdir/no_underscored_properties */

import * as Common from '../../core/common/common.js';
import * as SDK from '../../core/sdk/sdk.js';

export class Log {
  static pseudoWallTime(request: SDK.NetworkRequest.NetworkRequest, monotonicTime: number): Date {
    return new Date(request.pseudoWallTime(monotonicTime) * 1000);
  }

  static async build(requests: SDK.NetworkRequest.NetworkRequest[]): Promise<LogDTO> {
    const log = new Log();
    const entryPromises = [];
    for (const request of requests) {
      entryPromises.push(Entry.build(request));
    }
    const entries = await Promise.all(entryPromises);
    return {version: '1.2', creator: log._creator(), pages: log._buildPages(requests), entries};
  }

  _creator(): Creator {
    const webKitVersion = /AppleWebKit\/([^ ]+)/.exec(window.navigator.userAgent);

    return {name: 'WebInspector', version: webKitVersion ? webKitVersion[1] : 'n/a'};
  }

  _buildPages(requests: SDK.NetworkRequest.NetworkRequest[]): Page[] {
    const seenIdentifiers = new Set<number>();
    const pages = [];
    for (let i = 0; i < requests.length; ++i) {
      const request = requests[i];
      const page = SDK.PageLoad.PageLoad.forRequest(request);
      if (!page || seenIdentifiers.has(page.id)) {
        continue;
      }
      seenIdentifiers.add(page.id);
      pages.push(this._convertPage(page, request));
    }
    return pages;
  }

  _convertPage(page: SDK.PageLoad.PageLoad, request: SDK.NetworkRequest.NetworkRequest): Page {
    return {
      startedDateTime: Log.pseudoWallTime(request, page.startTime).toJSON(),
      id: 'page_' + page.id,
      title: page.url,
      pageTimings: {
        onContentLoad: this._pageEventTime(page, page.contentLoadTime),
        onLoad: this._pageEventTime(page, page.loadTime),
      },
    };
  }

  _pageEventTime(page: SDK.PageLoad.PageLoad, time: number): number {
    const startTime = page.startTime;
    if (time === -1 || startTime === -1) {
      return -1;
    }
    return Entry._toMilliseconds(time - startTime);
  }
}

export class Entry {
  _request: SDK.NetworkRequest.NetworkRequest;
  constructor(request: SDK.NetworkRequest.NetworkRequest) {
    this._request = request;
  }

  static _toMilliseconds(time: number): number {
    return time === -1 ? -1 : time * 1000;
  }

  static async build(request: SDK.NetworkRequest.NetworkRequest): Promise<EntryDTO> {
    const harEntry = new Entry(request);
    let ipAddress = harEntry._request.remoteAddress();
    const portPositionInString = ipAddress.lastIndexOf(':');
    if (portPositionInString !== -1) {
      ipAddress = ipAddress.substr(0, portPositionInString);
    }

    const timings = harEntry._buildTimings();
    let time = 0;
    // "ssl" is included in the connect field, so do not double count it.
    for (const t of [timings.blocked, timings.dns, timings.connect, timings.send, timings.wait, timings.receive]) {
      time += Math.max(t, 0);
    }

    const initiator = harEntry._request.initiator();
    let exportedInitiator: Protocol.Network.Initiator|null = null;
    if (initiator) {
      exportedInitiator = {
        type: initiator.type,
      };
      if (initiator.url !== undefined) {
        exportedInitiator.url = initiator.url;
      }
      if (initiator.lineNumber !== undefined) {
        exportedInitiator.lineNumber = initiator.lineNumber;
      }
      if (initiator.stack) {
        exportedInitiator.stack = initiator.stack;
      }
    }

    const entry: EntryDTO = {
      _fromCache: undefined,
      _initiator: exportedInitiator,
      _priority: harEntry._request.priority(),
      _resourceType: harEntry._request.resourceType().name(),
      _webSocketMessages: undefined,
      cache: {},
      connection: undefined,
      pageref: undefined,
      request: await harEntry._buildRequest(),
      response: harEntry._buildResponse(),
      // IPv6 address should not have square brackets per (https://tools.ietf.org/html/rfc2373#section-2.2).
      serverIPAddress: ipAddress.replace(/\[\]/g, ''),
      startedDateTime: Log.pseudoWallTime(harEntry._request, harEntry._request.issueTime()).toJSON(),
      time: time,
      timings: timings,
    };

    // Chrome specific.

    if (harEntry._request.cached()) {
      entry._fromCache = harEntry._request.cachedInMemory() ? 'memory' : 'disk';
    } else {
      delete entry._fromCache;
    }

    if (harEntry._request.connectionId !== '0') {
      entry.connection = harEntry._request.connectionId;
    } else {
      delete entry.connection;
    }

    const page = SDK.PageLoad.PageLoad.forRequest(harEntry._request);
    if (page) {
      entry.pageref = 'page_' + page.id;
    } else {
      delete entry.pageref;
    }

    if (harEntry._request.resourceType() === Common.ResourceType.resourceTypes.WebSocket) {
      const messages = [];
      for (const message of harEntry._request.frames()) {
        messages.push({type: message.type, time: message.time, opcode: message.opCode, data: message.text});
      }
      entry._webSocketMessages = messages;
    } else {
      delete entry._webSocketMessages;
    }

    return entry;
  }

  async _buildRequest(): Promise<Request> {
    const headersText = this._request.requestHeadersText();
    const res: Request = {
      method: this._request.requestMethod,
      url: this._buildRequestURL(this._request.url()),
      httpVersion: this._request.requestHttpVersion(),
      headers: this._request.requestHeaders(),
      queryString: this._buildParameters(this._request.queryParameters || []),
      cookies: this._buildCookies(this._request.includedRequestCookies()),
      headersSize: headersText ? headersText.length : -1,
      bodySize: await this._requestBodySize(),
      postData: undefined,
    };
    const postData = await this._buildPostData();
    if (postData) {
      res.postData = postData;
    } else {
      delete res.postData;
    }

    return res;
  }

  _buildResponse(): Response {
    const headersText = this._request.responseHeadersText;
    return {
      status: this._request.statusCode,
      statusText: this._request.statusText,
      httpVersion: this._request.responseHttpVersion(),
      headers: this._request.responseHeaders,
      cookies: this._buildCookies(this._request.responseCookies),
      content: this._buildContent(),
      redirectURL: this._request.responseHeaderValue('Location') || '',
      headersSize: headersText ? headersText.length : -1,
      bodySize: this.responseBodySize,
      _transferSize: this._request.transferSize,
      _error: this._request.localizedFailDescription,
    };
  }

  _buildContent(): Content {
    const content = ({
      size: this._request.resourceSize,
      mimeType: this._request.mimeType || 'x-unknown',
      compression: undefined,
    } as Content);
    const compression = this.responseCompression;
    if (typeof compression === 'number') {
      content.compression = compression;
    } else {
      delete content.compression;
    }
    return content;
  }

  _buildTimings(): Timing {
    // Order of events: request_start = 0, [proxy], [dns], [connect [ssl]], [send], duration
    const timing = this._request.timing;
    const issueTime = this._request.issueTime();
    const startTime = this._request.startTime;

    const result: Timing = {
      blocked: -1,
      dns: -1,
      ssl: -1,
      connect: -1,
      send: 0,
      wait: 0,
      receive: 0,
      _blocked_queueing: -1,
      _blocked_proxy: undefined,
    };

    const queuedTime = (issueTime < startTime) ? startTime - issueTime : -1;
    result.blocked = Entry._toMilliseconds(queuedTime);
    result._blocked_queueing = Entry._toMilliseconds(queuedTime);

    let highestTime = 0;
    if (timing) {
      // "blocked" here represents both queued + blocked/stalled + proxy (ie: anything before request was started).
      // We pick the better of when the network request start was reported and pref timing.
      const blockedStart = leastNonNegative([timing.dnsStart, timing.connectStart, timing.sendStart]);
      if (blockedStart !== Infinity) {
        result.blocked += blockedStart;
      }

      // Proxy is part of blocked but sometimes (like quic) blocked is -1 but has proxy timings.
      if (timing.proxyEnd !== -1) {
        result._blocked_proxy = timing.proxyEnd - timing.proxyStart;
      }
      if (result._blocked_proxy && result._blocked_proxy > result.blocked) {
        result.blocked = result._blocked_proxy;
      }

      const dnsStart = timing.dnsEnd >= 0 ? blockedStart : 0;
      const dnsEnd = timing.dnsEnd >= 0 ? timing.dnsEnd : -1;
      result.dns = dnsEnd - dnsStart;

      // SSL timing is included in connection timing.
      const sslStart = timing.sslEnd > 0 ? timing.sslStart : 0;
      const sslEnd = timing.sslEnd > 0 ? timing.sslEnd : -1;
      result.ssl = sslEnd - sslStart;

      const connectStart = timing.connectEnd >= 0 ? leastNonNegative([dnsEnd, blockedStart]) : 0;
      const connectEnd = timing.connectEnd >= 0 ? timing.connectEnd : -1;
      result.connect = connectEnd - connectStart;

      // Send should not be -1 for legacy reasons even if it is served from cache.
      const sendStart = timing.sendEnd >= 0 ? Math.max(connectEnd, dnsEnd, blockedStart) : 0;
      const sendEnd = timing.sendEnd >= 0 ? timing.sendEnd : 0;
      result.send = sendEnd - sendStart;
      // Quic sometimes says that sendStart is before connectionEnd (see: crbug.com/740792)
      if (result.send < 0) {
        result.send = 0;
      }
      highestTime = Math.max(sendEnd, connectEnd, sslEnd, dnsEnd, blockedStart, 0);
    } else if (this._request.responseReceivedTime === -1) {
      // Means that we don't have any more details after blocked, so attribute all to blocked.
      result.blocked = Entry._toMilliseconds(this._request.endTime - issueTime);
      return result;
    }

    const requestTime = timing ? timing.requestTime : startTime;
    const waitStart = highestTime;
    const waitEnd = Entry._toMilliseconds(this._request.responseReceivedTime - requestTime);
    result.wait = waitEnd - waitStart;

    const receiveStart = waitEnd;
    const receiveEnd = Entry._toMilliseconds(this._request.endTime - requestTime);
    result.receive = Math.max(receiveEnd - receiveStart, 0);

    return result;

    function leastNonNegative(values: number[]): number {
      return values.reduce((best, value) => (value >= 0 && value < best) ? value : best, Infinity);
    }
  }

  async _buildPostData(): Promise<PostData|null> {
    const postData = await this._request.requestFormData();
    if (!postData) {
      return null;
    }
    const res: PostData = {mimeType: this._request.requestContentType() || '', text: postData, params: undefined};
    const formParameters = await this._request.formParameters();
    if (formParameters) {
      res.params = this._buildParameters(formParameters);
    } else {
      delete res.params;
    }
    return res;
  }

  _buildParameters(parameters: Parameter[]): Parameter[] {
    return parameters.slice();
  }

  _buildRequestURL(url: string): string {
    return url.split('#', 2)[0];
  }

  _buildCookies(cookies: SDK.Cookie.Cookie[]): CookieDTO[] {
    return cookies.map(this._buildCookie.bind(this));
  }

  _buildCookie(cookie: SDK.Cookie.Cookie): CookieDTO {
    const c: CookieDTO = {
      name: cookie.name(),
      value: cookie.value(),
      path: cookie.path(),
      domain: cookie.domain(),
      expires: cookie.expiresDate(Log.pseudoWallTime(this._request, this._request.startTime)),
      httpOnly: cookie.httpOnly(),
      secure: cookie.secure(),
      sameSite: undefined,
    };
    if (cookie.sameSite()) {
      c.sameSite = cookie.sameSite();
    } else {
      delete c.sameSite;
    }
    return c;
  }

  async _requestBodySize(): Promise<number> {
    const postData = await this._request.requestFormData();
    if (!postData) {
      return 0;
    }

    // As per the har spec, returns the length in bytes of the posted data.
    // TODO(jarhar): This will be wrong if the underlying encoding is not UTF-8. SDK.NetworkRequest.NetworkRequest.requestFormData is
    //   assumed to be UTF-8 because the backend decodes post data to a UTF-8 string regardless of the provided
    //   content-type/charset in InspectorNetworkAgent::FormDataToString
    return new TextEncoder().encode(postData).length;
  }

  get responseBodySize(): number {
    if (this._request.cached() || this._request.statusCode === 304) {
      return 0;
    }
    if (!this._request.responseHeadersText) {
      return -1;
    }
    return this._request.transferSize - this._request.responseHeadersText.length;
  }

  get responseCompression(): number|undefined {
    if (this._request.cached() || this._request.statusCode === 304 || this._request.statusCode === 206) {
      return;
    }
    if (!this._request.responseHeadersText) {
      return;
    }
    return this._request.resourceSize - this.responseBodySize;
  }
}

export interface Timing {
  blocked: number;
  dns: number;
  ssl: number;
  connect: number;
  send: number;
  wait: number;
  receive: number;
  // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration
  // eslint-disable-next-line @typescript-eslint/naming-convention
  _blocked_queueing: number;
  // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration
  // eslint-disable-next-line @typescript-eslint/naming-convention
  _blocked_proxy?: number;
}

export interface Parameter {
  name: string;
  value: string;
}

export interface Content {
  size: number;
  mimeType: string;
  compression?: number;
  text?: string;
  encoding?: string;
}

export interface Request {
  method: string;
  url: string;
  httpVersion: string;
  headers: Object;
  queryString: Parameter[];
  cookies: CookieDTO[];
  headersSize: number;
  bodySize: number;
  postData?: PostData;
}

export interface Response {
  status: number;
  statusText: string;
  httpVersion: string;
  headers: Object;
  cookies: CookieDTO[];
  content: Content;
  redirectURL: string;
  headersSize: number;
  bodySize: number;
  _transferSize: number;
  _error: string|null;
}

export interface EntryDTO {
  _fromCache?: string;
  _initiator: Protocol.Network.Initiator|null;
  _priority: Protocol.Network.ResourcePriority|null;
  _resourceType: string;
  _webSocketMessages?: Object[];
  cache: Object;
  connection?: string;
  pageref?: string;
  request: Request;
  response: Response;
  serverIPAddress: string;
  startedDateTime: string|Object;
  time: number;
  timings: Timing;
}

export interface PostData {
  mimeType: string;
  params?: Parameter[];
  text: string;
}

export interface CookieDTO {
  name: string;
  value: string;
  path: string;
  domain: string;
  expires: Date|null;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: Protocol.Network.CookieSameSite;
}

export interface Page {
  startedDateTime: string|Object;
  id: string;
  title: string;
  pageTimings: {
    onContentLoad: number,
    onLoad: number,
  };
}

export interface Creator {
  version: string;
  name: string;
}

export interface LogDTO {
  version: string;
  creator: Creator;
  pages: Page[];
  entries: EntryDTO[];
}

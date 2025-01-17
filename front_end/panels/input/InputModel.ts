// Copyright 2019 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/* eslint-disable rulesdir/no_underscored_properties */

import * as SDK from '../../core/sdk/sdk.js';

export class InputModel extends SDK.SDKModel.SDKModel {
  _inputAgent: ProtocolProxyApi.InputApi;
  _eventDispatchTimer: number;
  _dispatchEventDataList: EventData[];
  _finishCallback: (() => void)|null;
  _dispatchingIndex!: number;
  _lastEventTime?: number|null;
  _replayPaused?: boolean;

  constructor(target: SDK.SDKModel.Target) {
    super(target);
    this._inputAgent = target.inputAgent();
    this._eventDispatchTimer = 0;
    this._dispatchEventDataList = [];
    this._finishCallback = null;

    this._reset();
  }

  _reset(): void {
    this._lastEventTime = null;
    this._replayPaused = false;
    this._dispatchingIndex = 0;
    window.clearTimeout(this._eventDispatchTimer);
  }

  setEvents(tracingModel: SDK.TracingModel.TracingModel): void {
    this._dispatchEventDataList = [];
    for (const process of tracingModel.sortedProcesses()) {
      for (const thread of process.sortedThreads()) {
        this._processThreadEvents(tracingModel, thread);
      }
    }
    function compareTimestamp(a: EventData, b: EventData): number {
      return a.timestamp - b.timestamp;
    }
    this._dispatchEventDataList.sort(compareTimestamp);
  }

  startReplay(finishCallback: (() => void)|null): void {
    this._reset();
    this._finishCallback = finishCallback;
    if (this._dispatchEventDataList.length) {
      this._dispatchNextEvent();
    } else {
      this._replayStopped();
    }
  }

  pause(): void {
    window.clearTimeout(this._eventDispatchTimer);
    if (this._dispatchingIndex >= this._dispatchEventDataList.length) {
      this._replayStopped();
    } else {
      this._replayPaused = true;
    }
  }

  resume(): void {
    this._replayPaused = false;
    if (this._dispatchingIndex < this._dispatchEventDataList.length) {
      this._dispatchNextEvent();
    }
  }

  _processThreadEvents(_tracingModel: SDK.TracingModel.TracingModel, thread: SDK.TracingModel.Thread): void {
    for (const event of thread.events()) {
      if (event.name === 'EventDispatch' && this._isValidInputEvent(event.args.data)) {
        this._dispatchEventDataList.push(event.args.data);
      }
    }
  }

  _isValidInputEvent(eventData: EventData): boolean {
    return this._isMouseEvent(eventData as MouseEventData) || this._isKeyboardEvent(eventData as KeyboardEventData);
  }

  _isMouseEvent(eventData: MouseEventData): boolean {
    if (!MOUSE_EVENT_TYPE_TO_REQUEST_TYPE.has(eventData.type)) {
      return false;
    }
    if (!('x' in eventData && 'y' in eventData)) {
      return false;
    }
    return true;
  }

  _isKeyboardEvent(eventData: KeyboardEventData): boolean {
    if (!KEYBOARD_EVENT_TYPE_TO_REQUEST_TYPE.has(eventData.type)) {
      return false;
    }
    if (!('code' in eventData && 'key' in eventData)) {
      return false;
    }
    return true;
  }

  _dispatchNextEvent(): void {
    const eventData = this._dispatchEventDataList[this._dispatchingIndex];
    this._lastEventTime = eventData.timestamp;
    if (MOUSE_EVENT_TYPE_TO_REQUEST_TYPE.has(eventData.type)) {
      this._dispatchMouseEvent(eventData as MouseEventData);
    } else if (KEYBOARD_EVENT_TYPE_TO_REQUEST_TYPE.has(eventData.type)) {
      this._dispatchKeyEvent(eventData as KeyboardEventData);
    }

    ++this._dispatchingIndex;
    if (this._dispatchingIndex < this._dispatchEventDataList.length) {
      const waitTime = (this._dispatchEventDataList[this._dispatchingIndex].timestamp - this._lastEventTime) / 1000;
      this._eventDispatchTimer = window.setTimeout(this._dispatchNextEvent.bind(this), waitTime);
    } else {
      this._replayStopped();
    }
  }

  async _dispatchMouseEvent(eventData: MouseEventData): Promise<void> {
    const type = MOUSE_EVENT_TYPE_TO_REQUEST_TYPE.get(eventData.type);
    if (!type) {
      throw new Error(`Could not find mouse event type for eventData ${eventData.type}`);
    }
    const buttonActionName = BUTTONID_TO_ACTION_NAME.get(eventData.button);
    const params = {
      type,
      x: eventData.x,
      y: eventData.y,
      modifiers: eventData.modifiers,
      button: (eventData.type === 'mousedown' || eventData.type === 'mouseup') ? buttonActionName :
                                                                                 Protocol.Input.MouseButton.None,
      buttons: eventData.buttons,
      clickCount: eventData.clickCount,
      deltaX: eventData.deltaX,
      deltaY: eventData.deltaY,
    };
    await this._inputAgent.invoke_dispatchMouseEvent(params);
  }

  async _dispatchKeyEvent(eventData: KeyboardEventData): Promise<void> {
    const type = KEYBOARD_EVENT_TYPE_TO_REQUEST_TYPE.get(eventData.type);
    if (!type) {
      throw new Error(`Could not find key event type for eventData ${eventData.type}`);
    }
    const text = eventData.type === 'keypress' ? eventData.key[0] : undefined;
    const params = {
      type,
      modifiers: eventData.modifiers,
      text: text,
      unmodifiedText: text ? text.toLowerCase() : undefined,
      code: eventData.code,
      key: eventData.key,
    };
    await this._inputAgent.invoke_dispatchKeyEvent(params);
  }

  _replayStopped(): void {
    window.clearTimeout(this._eventDispatchTimer);
    this._reset();
    if (this._finishCallback) {
      this._finishCallback();
    }
  }
}

const MOUSE_EVENT_TYPE_TO_REQUEST_TYPE = new Map<string, Protocol.Input.DispatchMouseEventRequestType>([
  ['mousedown', Protocol.Input.DispatchMouseEventRequestType.MousePressed],
  ['mouseup', Protocol.Input.DispatchMouseEventRequestType.MouseReleased],
  ['mousemove', Protocol.Input.DispatchMouseEventRequestType.MouseMoved],
  ['wheel', Protocol.Input.DispatchMouseEventRequestType.MouseWheel],
]);

const KEYBOARD_EVENT_TYPE_TO_REQUEST_TYPE = new Map<string, Protocol.Input.DispatchKeyEventRequestType>([
  ['keydown', Protocol.Input.DispatchKeyEventRequestType.KeyDown],
  ['keyup', Protocol.Input.DispatchKeyEventRequestType.KeyUp],
  ['keypress', Protocol.Input.DispatchKeyEventRequestType.Char],
]);

const BUTTONID_TO_ACTION_NAME = new Map<number, Protocol.Input.MouseButton>([
  [0, Protocol.Input.MouseButton.Left],
  [1, Protocol.Input.MouseButton.Middle],
  [2, Protocol.Input.MouseButton.Right],
  [3, Protocol.Input.MouseButton.Back],
  [4, Protocol.Input.MouseButton.Forward],
]);

SDK.SDKModel.SDKModel.register(InputModel, {capabilities: SDK.SDKModel.Capability.Input, autostart: false});
export interface MouseEventData {
  type: string;
  modifiers: number;
  timestamp: number;
  x: number;
  y: number;
  button: number;
  buttons: number;
  clickCount: number;
  deltaX: number;
  deltaY: number;
}
export interface KeyboardEventData {
  type: string;
  modifiers: number;
  timestamp: number;
  code: string;
  key: string;
}

export type EventData = MouseEventData|KeyboardEventData;

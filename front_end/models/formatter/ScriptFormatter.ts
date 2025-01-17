/*
 * Copyright (C) 2011 Google Inc. All rights reserved.
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

/* eslint-disable rulesdir/no_underscored_properties */

import * as Common from '../../core/common/common.js';  // eslint-disable-line no-unused-vars
import * as Platform from '../../core/platform/platform.js';

import {FormatMapping, FormatResult, formatterWorkerPool} from './FormatterWorkerPool.js';  // eslint-disable-line no-unused-vars

export class FormatterInterface {
  static format(
      contentType: Common.ResourceType.ResourceType, mimeType: string, content: string,
      callback: (arg0: string, arg1: FormatterSourceMapping) => Promise<void>): void {
    if (contentType.isDocumentOrScriptOrStyleSheet()) {
      new ScriptFormatter(mimeType, content, callback);
    } else {
      new ScriptIdentityFormatter(mimeType, content, callback);
    }
  }
  static locationToPosition(lineEndings: number[], lineNumber: number, columnNumber: number): number {
    const position = lineNumber ? lineEndings[lineNumber - 1] + 1 : 0;
    return position + columnNumber;
  }
  static positionToLocation(lineEndings: number[], position: number): number[] {
    const lineNumber =
        Platform.ArrayUtilities.upperBound(lineEndings, position - 1, Platform.ArrayUtilities.DEFAULT_COMPARATOR);
    let columnNumber;
    if (!lineNumber) {
      columnNumber = position;
    } else {
      columnNumber = position - lineEndings[lineNumber - 1] - 1;
    }
    return [lineNumber, columnNumber];
  }
}

export class ScriptFormatter extends FormatterInterface {
  _mimeType: string;
  _originalContent: string;
  _callback: (arg0: string, arg1: FormatterSourceMapping) => Promise<void>;

  constructor(
      mimeType: string, content: string, callback: (arg0: string, arg1: FormatterSourceMapping) => Promise<void>) {
    super();

    this._mimeType = mimeType;
    this._originalContent = content.replace(/\r\n?|[\n\u2028\u2029]/g, '\n').replace(/^\uFEFF/, '');
    this._callback = callback;

    this._initialize();
  }

  async _initialize(): Promise<void> {
    const pool = formatterWorkerPool();
    const indent = Common.Settings.Settings.instance().moduleSetting('textEditorIndent').get();

    const formatResult = await pool.format(this._mimeType, this._originalContent, indent);
    if (!formatResult) {
      this._callback(this._originalContent, new IdentityFormatterSourceMapping());
    } else {
      this._didFormatContent(formatResult);
    }
  }

  _didFormatContent(formatResult: FormatResult): void {
    const originalContentLineEndings = Platform.StringUtilities.findLineEndingIndexes(this._originalContent);
    const formattedContentLineEndings = Platform.StringUtilities.findLineEndingIndexes(formatResult.content);

    const sourceMapping =
        new FormatterSourceMappingImpl(originalContentLineEndings, formattedContentLineEndings, formatResult.mapping);
    this._callback(formatResult.content, sourceMapping);
  }
}

class ScriptIdentityFormatter extends FormatterInterface {
  constructor(
      mimeType: string, content: string, callback: (arg0: string, arg1: FormatterSourceMapping) => Promise<void>) {
    super();

    callback(content, new IdentityFormatterSourceMapping());
  }
}

export abstract class FormatterSourceMapping {
  abstract originalToFormatted(lineNumber: number, columnNumber?: number): number[];
  abstract formattedToOriginal(lineNumber: number, columnNumber?: number): number[];
}

class IdentityFormatterSourceMapping extends FormatterSourceMapping {
  originalToFormatted(lineNumber: number, columnNumber?: number): number[] {
    return [lineNumber, columnNumber || 0];
  }

  formattedToOriginal(lineNumber: number, columnNumber?: number): number[] {
    return [lineNumber, columnNumber || 0];
  }
}

class FormatterSourceMappingImpl extends FormatterSourceMapping {
  _originalLineEndings: number[];
  _formattedLineEndings: number[];
  _mapping: FormatMapping;

  constructor(originalLineEndings: number[], formattedLineEndings: number[], mapping: FormatMapping) {
    super();

    this._originalLineEndings = originalLineEndings;
    this._formattedLineEndings = formattedLineEndings;
    this._mapping = mapping;
  }

  originalToFormatted(lineNumber: number, columnNumber?: number): number[] {
    const originalPosition =
        FormatterInterface.locationToPosition(this._originalLineEndings, lineNumber, columnNumber || 0);
    const formattedPosition =
        this._convertPosition(this._mapping.original, this._mapping.formatted, originalPosition || 0);
    return FormatterInterface.positionToLocation(this._formattedLineEndings, formattedPosition);
  }

  formattedToOriginal(lineNumber: number, columnNumber?: number): number[] {
    const formattedPosition =
        FormatterInterface.locationToPosition(this._formattedLineEndings, lineNumber, columnNumber || 0);
    const originalPosition = this._convertPosition(this._mapping.formatted, this._mapping.original, formattedPosition);
    return FormatterInterface.positionToLocation(this._originalLineEndings, originalPosition || 0);
  }

  _convertPosition(positions1: number[], positions2: number[], position: number): number {
    const index =
        Platform.ArrayUtilities.upperBound(positions1, position, Platform.ArrayUtilities.DEFAULT_COMPARATOR) - 1;
    let convertedPosition: number = positions2[index] + position - positions1[index];
    if (index < positions2.length - 1 && convertedPosition > positions2[index + 1]) {
      convertedPosition = positions2[index + 1];
    }
    return convertedPosition;
  }
}

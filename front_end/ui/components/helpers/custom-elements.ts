// Copyright 2021 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/*
 * Function to define a customElement and display an error if the element has already been defined.
 */

export function defineComponent(tagName: string, componentClass: CustomElementConstructor): void {
  if (customElements.get(tagName)) {
    console.error(`${tagName} already defined!`);
    return;
  }
  customElements.define(tagName, componentClass);
}

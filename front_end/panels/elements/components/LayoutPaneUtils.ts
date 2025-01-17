// Copyright 2020 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as Common from '../../../core/common/common.js';

export interface BaseSettingOption {
  title: string;
}

export interface BooleanSettingOption extends BaseSettingOption {
  value: boolean;
}

export interface EnumSettingOption extends BaseSettingOption {
  value: string;
}

export interface BaseSetting {
  name: string;
  type: Common.Settings.SettingType.BOOLEAN|Common.Settings.SettingType.ENUM;
  title: string;
}

export type BooleanSetting = BaseSetting&{options: BooleanSettingOption[], value: boolean};
export type EnumSetting = BaseSetting&{options: EnumSettingOption[], value: string};
export type Setting = EnumSetting|BooleanSetting;

export interface LayoutElement {
  id: number;
  color: string;
  name: string;
  domId?: string;
  domClasses?: string[];
  enabled: boolean;
  reveal: () => void;
  toggle: (value: boolean) => void;
  setColor: (value: string) => void;
  highlight: () => void;
  hideHighlight: () => void;
}

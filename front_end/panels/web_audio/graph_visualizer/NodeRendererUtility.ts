// Copyright 2019 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/* eslint-disable rulesdir/no_underscored_properties */

import {AudioParamRadius, InputPortRadius, LeftSideTopPadding, Point, Size, TotalInputPortHeight, TotalOutputPortHeight, TotalParamPortHeight} from './GraphStyle.js';  // eslint-disable-line no-unused-vars

/**
 * Calculate the x, y value of input port.
 * Input ports are placed near the top of the left-side border.
 */
export const calculateInputPortXY = (portIndex: number): Point => {
  const y = InputPortRadius + LeftSideTopPadding + portIndex * TotalInputPortHeight;
  return {x: 0, y: y};
};

/**
 * Calculate the x, y value of output port.
 * Output ports are placed near the center of the right-side border.
 */
export const calculateOutputPortXY = (portIndex: number, nodeSize: Size, numberOfOutputs: number): Point => {
  const {width, height} = nodeSize;
  const outputPortY = (height / 2) + (2 * portIndex - numberOfOutputs + 1) * TotalOutputPortHeight / 2;

  return {x: width, y: outputPortY};
};

/**
 * Calculate the x, y value of param port.
 * Param ports are placed near the bottom of the left-side border.
 */
export const calculateParamPortXY = (portIndex: number, offsetY: number): Point => {
  const paramPortY = offsetY + TotalParamPortHeight * (portIndex + 1) - AudioParamRadius;
  return {x: 0, y: paramPortY};
};

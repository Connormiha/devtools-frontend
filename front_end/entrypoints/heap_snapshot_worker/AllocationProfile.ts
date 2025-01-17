/*
 * Copyright (C) 2013 Google Inc. All rights reserved.
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

import * as HeapSnapshotModel from '../../models/heap_snapshot_model/heap_snapshot_model.js';

export class AllocationProfile {
  // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _strings: any;
  // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _liveObjectStats: any;
  _nextNodeId: number;
  _functionInfos: FunctionAllocationInfo[];
  _idToNode: {[x: number]: BottomUpAllocationNode|null};
  _idToTopDownNode: {[x: number]: TopDownAllocationNode};
  _collapsedTopNodeIdToFunctionInfo: {[x: number]: FunctionAllocationInfo};
  _traceTops: HeapSnapshotModel.HeapSnapshotModel.SerializedAllocationNode[];
  _traceTree: TopDownAllocationNode;

  // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(profile: any, liveObjectStats: any) {
    this._strings = profile.strings;
    this._liveObjectStats = liveObjectStats;

    this._nextNodeId = 1;
    this._functionInfos = [];

    this._idToNode = {};

    this._idToTopDownNode = {};

    this._collapsedTopNodeIdToFunctionInfo = {};

    this._traceTops = [];

    this._buildFunctionAllocationInfos(profile);
    this._traceTree = this._buildAllocationTree(profile, liveObjectStats);
  }

  // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _buildFunctionAllocationInfos(profile: any): void {
    const strings = this._strings;

    const functionInfoFields = profile.snapshot.meta.trace_function_info_fields;
    const functionNameOffset = functionInfoFields.indexOf('name');
    const scriptNameOffset = functionInfoFields.indexOf('script_name');
    const scriptIdOffset = functionInfoFields.indexOf('script_id');
    const lineOffset = functionInfoFields.indexOf('line');
    const columnOffset = functionInfoFields.indexOf('column');
    const functionInfoFieldCount = functionInfoFields.length;

    const rawInfos = profile.trace_function_infos;
    const infoLength = rawInfos.length;
    const functionInfos = this._functionInfos = new Array(infoLength / functionInfoFieldCount);
    let index = 0;
    for (let i = 0; i < infoLength; i += functionInfoFieldCount) {
      functionInfos[index++] = new FunctionAllocationInfo(
          strings[rawInfos[i + functionNameOffset]], strings[rawInfos[i + scriptNameOffset]],
          rawInfos[i + scriptIdOffset], rawInfos[i + lineOffset], rawInfos[i + columnOffset]);
    }
  }

  // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _buildAllocationTree(profile: any, liveObjectStats: any): TopDownAllocationNode {
    const traceTreeRaw = profile.trace_tree;
    const functionInfos = this._functionInfos;
    const idToTopDownNode = this._idToTopDownNode;

    const traceNodeFields = profile.snapshot.meta.trace_node_fields;
    const nodeIdOffset = traceNodeFields.indexOf('id');
    const functionInfoIndexOffset = traceNodeFields.indexOf('function_info_index');
    const allocationCountOffset = traceNodeFields.indexOf('count');
    const allocationSizeOffset = traceNodeFields.indexOf('size');
    const childrenOffset = traceNodeFields.indexOf('children');
    const nodeFieldCount = traceNodeFields.length;

    function traverseNode(
        // TODO(crbug.com/1172300) Ignored during the jsdoc to ts migration)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rawNodeArray: any, nodeOffset: any, parent: TopDownAllocationNode|null): TopDownAllocationNode {
      const functionInfo = functionInfos[rawNodeArray[nodeOffset + functionInfoIndexOffset]];
      const id = rawNodeArray[nodeOffset + nodeIdOffset];
      const stats = liveObjectStats[id];
      const liveCount = stats ? stats.count : 0;
      const liveSize = stats ? stats.size : 0;
      const result = new TopDownAllocationNode(
          id, functionInfo, rawNodeArray[nodeOffset + allocationCountOffset],
          rawNodeArray[nodeOffset + allocationSizeOffset], liveCount, liveSize, parent);
      idToTopDownNode[id] = result;
      functionInfo.addTraceTopNode(result);

      const rawChildren = rawNodeArray[nodeOffset + childrenOffset];
      for (let i = 0; i < rawChildren.length; i += nodeFieldCount) {
        result.children.push(traverseNode(rawChildren, i, result));
      }

      return result;
    }

    return traverseNode(traceTreeRaw, 0, null);
  }

  serializeTraceTops(): HeapSnapshotModel.HeapSnapshotModel.SerializedAllocationNode[] {
    if (this._traceTops) {
      return this._traceTops;
    }

    const result: HeapSnapshotModel.HeapSnapshotModel.SerializedAllocationNode[] = this._traceTops = [];
    const functionInfos = this._functionInfos;
    for (let i = 0; i < functionInfos.length; i++) {
      const info = functionInfos[i];
      if (info.totalCount === 0) {
        continue;
      }
      const nodeId = this._nextNodeId++;
      const isRoot = i === 0;
      result.push(this._serializeNode(
          nodeId, info, info.totalCount, info.totalSize, info.totalLiveCount, info.totalLiveSize, !isRoot));
      this._collapsedTopNodeIdToFunctionInfo[nodeId] = info;
    }
    result.sort(function(a, b) {
      return b.size - a.size;
    });
    return result;
  }

  serializeCallers(nodeId: number): HeapSnapshotModel.HeapSnapshotModel.AllocationNodeCallers {
    let node = this._ensureBottomUpNode(nodeId);
    const nodesWithSingleCaller = [];
    while (node.callers().length === 1) {
      node = node.callers()[0];
      nodesWithSingleCaller.push(this._serializeCaller(node));
    }

    const branchingCallers = [];
    const callers = node.callers();
    for (let i = 0; i < callers.length; i++) {
      branchingCallers.push(this._serializeCaller(callers[i]));
    }

    return new HeapSnapshotModel.HeapSnapshotModel.AllocationNodeCallers(nodesWithSingleCaller, branchingCallers);
  }

  serializeAllocationStack(traceNodeId: number): HeapSnapshotModel.HeapSnapshotModel.AllocationStackFrame[] {
    let node: (TopDownAllocationNode|null)|TopDownAllocationNode = this._idToTopDownNode[traceNodeId];
    const result = [];
    while (node) {
      const functionInfo = node.functionInfo;
      result.push(new HeapSnapshotModel.HeapSnapshotModel.AllocationStackFrame(
          functionInfo.functionName, functionInfo.scriptName, functionInfo.scriptId, functionInfo.line,
          functionInfo.column));
      node = node.parent;
    }
    return result;
  }

  traceIds(allocationNodeId: number): number[] {
    return this._ensureBottomUpNode(allocationNodeId).traceTopIds;
  }

  _ensureBottomUpNode(nodeId: number): BottomUpAllocationNode {
    let node: (BottomUpAllocationNode|null) = this._idToNode[nodeId];
    if (!node) {
      const functionInfo = this._collapsedTopNodeIdToFunctionInfo[nodeId];
      node = functionInfo.bottomUpRoot();
      delete this._collapsedTopNodeIdToFunctionInfo[nodeId];
      this._idToNode[nodeId] = node;
    }
    return /** @type {!BottomUpAllocationNode} */ node as BottomUpAllocationNode;
  }

  _serializeCaller(node: BottomUpAllocationNode): HeapSnapshotModel.HeapSnapshotModel.SerializedAllocationNode {
    const callerId = this._nextNodeId++;
    this._idToNode[callerId] = node;
    return this._serializeNode(
        callerId, node.functionInfo, node.allocationCount, node.allocationSize, node.liveCount, node.liveSize,
        node.hasCallers());
  }

  _serializeNode(
      nodeId: number, functionInfo: FunctionAllocationInfo, count: number, size: number, liveCount: number,
      liveSize: number, hasChildren: boolean): HeapSnapshotModel.HeapSnapshotModel.SerializedAllocationNode {
    return new HeapSnapshotModel.HeapSnapshotModel.SerializedAllocationNode(
        nodeId, functionInfo.functionName, functionInfo.scriptName, functionInfo.scriptId, functionInfo.line,
        functionInfo.column, count, size, liveCount, liveSize, hasChildren);
  }
}

export class TopDownAllocationNode {
  id: number;
  functionInfo: FunctionAllocationInfo;
  allocationCount: number;
  allocationSize: number;
  liveCount: number;
  liveSize: number;
  parent: TopDownAllocationNode|null;
  children: TopDownAllocationNode[];
  constructor(
      id: number, functionInfo: FunctionAllocationInfo, count: number, size: number, liveCount: number,
      liveSize: number, parent: TopDownAllocationNode|null) {
    this.id = id;
    this.functionInfo = functionInfo;
    this.allocationCount = count;
    this.allocationSize = size;
    this.liveCount = liveCount;
    this.liveSize = liveSize;
    this.parent = parent;

    this.children = [];
  }
}

export class BottomUpAllocationNode {
  functionInfo: FunctionAllocationInfo;
  allocationCount: number;
  allocationSize: number;
  liveCount: number;
  liveSize: number;
  traceTopIds: number[];
  _callers: BottomUpAllocationNode[];
  constructor(functionInfo: FunctionAllocationInfo) {
    this.functionInfo = functionInfo;
    this.allocationCount = 0;
    this.allocationSize = 0;
    this.liveCount = 0;
    this.liveSize = 0;

    this.traceTopIds = [];

    this._callers = [];
  }

  addCaller(traceNode: TopDownAllocationNode): BottomUpAllocationNode {
    const functionInfo = traceNode.functionInfo;
    let result;
    for (let i = 0; i < this._callers.length; i++) {
      const caller = this._callers[i];
      if (caller.functionInfo === functionInfo) {
        result = caller;
        break;
      }
    }
    if (!result) {
      result = new BottomUpAllocationNode(functionInfo);
      this._callers.push(result);
    }
    return result;
  }

  callers(): BottomUpAllocationNode[] {
    return this._callers;
  }

  hasCallers(): boolean {
    return this._callers.length > 0;
  }
}

export class FunctionAllocationInfo {
  functionName: string;
  scriptName: string;
  scriptId: number;
  line: number;
  column: number;
  totalCount: number;
  totalSize: number;
  totalLiveCount: number;
  totalLiveSize: number;
  _traceTops: TopDownAllocationNode[];
  _bottomUpTree?: BottomUpAllocationNode;
  constructor(functionName: string, scriptName: string, scriptId: number, line: number, column: number) {
    this.functionName = functionName;
    this.scriptName = scriptName;
    this.scriptId = scriptId;
    this.line = line;
    this.column = column;
    this.totalCount = 0;
    this.totalSize = 0;
    this.totalLiveCount = 0;
    this.totalLiveSize = 0;

    this._traceTops = [];
  }

  addTraceTopNode(node: TopDownAllocationNode): void {
    if (node.allocationCount === 0) {
      return;
    }
    this._traceTops.push(node);
    this.totalCount += node.allocationCount;
    this.totalSize += node.allocationSize;
    this.totalLiveCount += node.liveCount;
    this.totalLiveSize += node.liveSize;
  }

  bottomUpRoot(): BottomUpAllocationNode|null {
    if (!this._traceTops.length) {
      return null;
    }
    if (!this._bottomUpTree) {
      this._buildAllocationTraceTree();
    }
    return /** @type {!BottomUpAllocationNode} */ this._bottomUpTree as BottomUpAllocationNode;
  }

  _buildAllocationTraceTree(): void {
    this._bottomUpTree = new BottomUpAllocationNode(this);

    for (let i = 0; i < this._traceTops.length; i++) {
      let node: (TopDownAllocationNode|null)|TopDownAllocationNode = this._traceTops[i];
      let bottomUpNode: BottomUpAllocationNode = this._bottomUpTree;
      const count = node.allocationCount;
      const size = node.allocationSize;
      const liveCount = node.liveCount;
      const liveSize = node.liveSize;
      const traceId = node.id;
      while (true) {
        bottomUpNode.allocationCount += count;
        bottomUpNode.allocationSize += size;
        bottomUpNode.liveCount += liveCount;
        bottomUpNode.liveSize += liveSize;
        bottomUpNode.traceTopIds.push(traceId);
        node = node.parent;
        if (node === null) {
          break;
        }

        bottomUpNode = bottomUpNode.addCaller(node);
      }
    }
  }
}

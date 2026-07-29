import { buildGroupedLayout, buildLayout } from "./layout";
import type { TopologyNode, TopologyEdge } from "@/types/topology";

export interface WorkerComputeRequest {
  type: "COMPUTE";
  payload: {
    nodes: TopologyNode[];
    edges: TopologyEdge[];
    highlightNodeIds: string[];
    expandedSiteIds: string[];
    activeTypeFilterTypes: string[];
    grouped: boolean;
  };
  _requestId: number;
}

export interface WorkerResultResponse {
  type: "RESULT";
  payload: {
    nodes: ReturnType<typeof buildGroupedLayout>["nodes"];
    edges: ReturnType<typeof buildGroupedLayout>["edges"];
    crossSiteEdgeCounts: Record<string, number>;
  };
  _requestId: number;
}

self.onmessage = (e: MessageEvent<WorkerComputeRequest>) => {
  if (e.data.type !== "COMPUTE") return;

  const { nodes, edges, highlightNodeIds, grouped } = e.data.payload;
  const _requestId = e.data._requestId;
  const highlightSet = new Set(highlightNodeIds);

  if (!grouped) {
    const result = buildLayout(nodes, edges, highlightSet);
    const response: WorkerResultResponse = {
      type: "RESULT",
      payload: {
        nodes: result.nodes,
        edges: result.edges,
        crossSiteEdgeCounts: {},
      },
      _requestId,
    };
    self.postMessage(response);
    return;
  }

  const { expandedSiteIds, activeTypeFilterTypes } = e.data.payload;

  const result = buildGroupedLayout(
    nodes,
    edges,
    highlightSet,
    new Set(expandedSiteIds),
    new Set(activeTypeFilterTypes),
  );

  const response: WorkerResultResponse = {
    type: "RESULT",
    payload: {
      nodes: result.nodes,
      edges: result.edges,
      crossSiteEdgeCounts: result.crossSiteEdgeCounts,
    },
    _requestId,
  };

  self.postMessage(response);
};

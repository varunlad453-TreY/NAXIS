import { useEffect, useMemo, useRef, useState } from "react";
import type { Node, Edge } from "reactflow";
import type { TopologyNode, TopologyEdge } from "@/types/topology";
import { buildGroupedLayout, buildLayout } from "./layout";
import type { GroupedLayoutResult } from "./layout";

export interface UseTopologyLayoutInput {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  highlightSet: Set<string>;
  expandedSites: Set<string>;
  activeTypeFilters: Set<string>;
  grouped?: boolean;
}

export interface UseTopologyLayoutResult {
  layoutNodes: Node[];
  layoutEdges: Edge[];
  isComputing: boolean;
}

export function useTopologyLayout(input: UseTopologyLayoutInput): UseTopologyLayoutResult {
  const { nodes, edges, highlightSet, expandedSites, activeTypeFilters, grouped = true } = input;

  const flatResult = useMemo(
    () => grouped ? null : buildLayout(nodes, edges, highlightSet),
    [grouped, nodes, edges, highlightSet],
  );

  const [result, setResult] = useState<GroupedLayoutResult>({
    nodes: [],
    edges: [],
    crossSiteEdgeCounts: {},
  });
  const [isComputing, setIsComputing] = useState(true);

  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const fallbackRef = useRef(false);

  useEffect(() => {
    try {
      const worker = new Worker(new URL("./layout.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;

      worker.onmessage = (e: MessageEvent) => {
        if (e.data.type === "RESULT" && e.data._requestId === requestIdRef.current) {
          setResult({
            nodes: e.data.payload.nodes,
            edges: e.data.payload.edges,
            crossSiteEdgeCounts: e.data.payload.crossSiteEdgeCounts,
          });
          setIsComputing(false);
        }
      };

      worker.onerror = () => {
        fallbackRef.current = true;
        worker.terminate();
        workerRef.current = null;
      };

      return () => {
        worker.terminate();
        workerRef.current = null;
      };
    } catch {
      fallbackRef.current = true;
    }
  }, []);

  useEffect(() => {
    setIsComputing(true);
    const id = ++requestIdRef.current;

    if (fallbackRef.current || !workerRef.current) {
      const timer = setTimeout(() => {
        if (id !== requestIdRef.current) return;
        const syncResult = buildGroupedLayout(nodes, edges, highlightSet, expandedSites, activeTypeFilters);
        setResult(syncResult);
        setIsComputing(false);
      }, 0);
      return () => clearTimeout(timer);
    }

    workerRef.current.postMessage({
      type: "COMPUTE",
      payload: {
        nodes,
        edges,
        highlightNodeIds: Array.from(highlightSet),
        expandedSiteIds: Array.from(expandedSites),
        activeTypeFilterTypes: Array.from(activeTypeFilters),
        grouped: true,
      },
      _requestId: id,
    });
  }, [nodes, edges, highlightSet, expandedSites, activeTypeFilters]);

  if (!grouped && flatResult) {
    return {
      layoutNodes: flatResult.nodes,
      layoutEdges: flatResult.edges,
      isComputing: false,
    };
  }

  return {
    layoutNodes: result.nodes,
    layoutEdges: result.edges,
    isComputing,
  };
}

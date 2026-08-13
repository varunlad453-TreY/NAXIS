/**
 * Topology Edge Types
 *
 * Edges communicate actual network relationships with health state.
 */

import { memo } from "react";
import { getBezierPath, BaseEdge, EdgeLabelRenderer, type EdgeProps } from "reactflow";
import type { GraphEdgeData } from "./topology-graph-model";

function TopologyEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style = {},
  markerEnd,
  selected,
}: EdgeProps<GraphEdgeData>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const edgeData = data as GraphEdgeData | undefined;
  const isPathTrace = edgeData?.isPathTrace ?? false;
  const isHighlighted = edgeData?.isHighlighted ?? false;
  const isDimmed = edgeData?.isDimmed ?? false;
  const linkSpeed = edgeData?.linkSpeed;

  const strokeColor = (style?.stroke as string) || "#9ca3af";

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          strokeWidth: isPathTrace ? 3 : selected ? 2.5 : (style?.strokeWidth as number) || 1.5,
          stroke: isPathTrace ? "#3b82f6" : selected ? "#3b82f6" : strokeColor,
          opacity: isDimmed ? 0.15 : 1,
        }}
      />

      {/* Path trace glow */}
      {isPathTrace && (
        <BaseEdge
          id={`${id}-glow`}
          path={edgePath}
          style={{
            stroke: "#3b82f6",
            strokeWidth: 8,
            opacity: 0.12,
            fill: "none",
          }}
        />
      )}

      {/* Link speed / interface label */}
      {linkSpeed && (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none rounded-sm bg-surface px-1 py-0.5 text-[9px] font-medium text-foreground-subtle border border-border/40"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            }}
          >
            {linkSpeed}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const TopologyEdge = memo(TopologyEdgeComponent);

export const topologyEdgeTypes = {
  topologyEdge: TopologyEdge,
};

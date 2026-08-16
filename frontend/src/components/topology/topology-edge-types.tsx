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
  const bundleCount = edgeData?.bundleCount;

  const strokeColor = (style?.stroke as string) || "#9ca3af";

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          strokeWidth: isPathTrace ? 2.5 : isHighlighted ? 2 : selected ? 2 : (style?.strokeWidth as number) || 1.5,
          stroke: isPathTrace ? "#ef4444" : isHighlighted ? "#3b82f6" : selected ? "#3b82f6" : strokeColor,
          opacity: isDimmed ? 0.15 : 1,
        }}
      />

      {/* Path trace / blast radius glow line */}
      {(isPathTrace || isHighlighted) && (
        <BaseEdge
          id={`${id}-glow`}
          path={edgePath}
          style={{
            stroke: isPathTrace ? "#ef4444" : "#3b82f6",
            strokeWidth: 6,
            opacity: 0.15,
            fill: "none",
          }}
        />
      )}

      {/* Bundle count badge — shows ×N when multiple parallel links are collapsed */}
      {bundleCount && bundleCount > 1 && (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none rounded-sm px-1 py-0.5 text-[9px] font-bold border"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              background: "#0f172a",
              borderColor: strokeColor + "60",
              color: strokeColor,
            }}
          >
            ×{bundleCount}
          </div>
        </EdgeLabelRenderer>
      )}

      {/* Link speed / interface label */}
      {linkSpeed && !bundleCount && (
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

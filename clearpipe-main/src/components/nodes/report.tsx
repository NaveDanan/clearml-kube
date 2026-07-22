'use client';

import React, { memo } from 'react';
import { NodeProps } from '@xyflow/react';
import { Badge } from '@/components/ui/badge';
import { ReportNodeData } from '@/types/pipeline';
import { BaseNodeComponent } from './base-node-component';
import { NodeExecutionResult } from './shared/types';

// Node content component for report
function ReportNodeContent({ data }: { data: ReportNodeData }) {
  return (
    <div className="space-y-1 text-xs">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Title:</span>
        <span className="font-medium truncate max-w-[150px]">{data.config.title}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Format:</span>
        <span className="font-medium uppercase">{data.config.outputFormat}</span>
      </div>
      {data.config.exportPath && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Path:</span>
          <span className="font-medium truncate max-w-[150px]">{data.config.exportPath}</span>
        </div>
      )}
      <div className="flex gap-1 flex-wrap">
        {data.config.includeMetrics && (
          <Badge variant="secondary" className="text-[10px] px-1">Metrics</Badge>
        )}
        {data.config.includeVisualizations && (
          <Badge variant="secondary" className="text-[10px] px-1">Charts</Badge>
        )}
        {data.config.includeModelCard && (
          <Badge variant="secondary" className="text-[10px] px-1">Model Card</Badge>
        )}
      </div>
      {data.config.customSections && data.config.customSections.length > 0 && (
        <div className="text-muted-foreground">
          {data.config.customSections.length} custom section(s)
        </div>
      )}
    </div>
  );
}

// Report node component
function ReportNodeComponent(props: NodeProps) {
  const data = props.data as ReportNodeData & Record<string, unknown>;
  
  return (
    <BaseNodeComponent {...props} data={data}>
      <ReportNodeContent data={data} />
    </BaseNodeComponent>
  );
}

export const ReportNode = memo(ReportNodeComponent);

// Generate report
export async function executeReport(config: any): Promise<NodeExecutionResult> {
  try {
    if (!config.title) {
      return { success: false, message: 'Report title not configured' };
    }

    // Simulate report generation
    await new Promise(resolve => setTimeout(resolve, 1200));

    const sections: string[] = [];
    if (config.includeMetrics) sections.push('Metrics');
    if (config.includeVisualizations) sections.push('Visualizations');
    if (config.includeModelCard) sections.push('Model Card');
    if (config.customSections) {
      sections.push(...config.customSections.map((s: any) => s.title));
    }

    const fileName = `${config.title.replace(/\s+/g, '_').toLowerCase()}.${config.outputFormat}`;

    return {
      success: true,
      message: `Report generated: ${fileName}`,
      data: {
        title: config.title,
        format: config.outputFormat,
        fileName,
        sections,
        generatedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    return { success: false, message: (error as Error).message };
  }
}

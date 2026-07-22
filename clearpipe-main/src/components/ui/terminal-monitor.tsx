'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Copy, Download, Trash2, Filter, X } from 'lucide-react';
import { Button } from './button';
import { Badge } from './badge';
import { ScrollArea } from './scroll-area';
import { Input } from './input';
import type { ExecutionLogs, TerminalLogEntry } from '@/types/pipeline';

interface TerminalMonitorProps {
  logs?: ExecutionLogs;
  isExecuting?: boolean;
  maxHeight?: string;
}

export function TerminalMonitor({ logs, isExecuting = false, maxHeight = 'h-64' }: TerminalMonitorProps) {
  const [filter, setFilter] = useState<'all' | 'stdout' | 'stderr' | 'system'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [isExpanded, setIsExpanded] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs?.logs.length]);

  if (!logs || logs.logs.length === 0) {
    return (
      <div className="border rounded-lg bg-muted/30 p-4">
        <p className="text-sm text-muted-foreground">
          {isExecuting ? 'Waiting for output...' : 'No execution output available'}
        </p>
      </div>
    );
  }

  const filteredLogs = logs.logs.filter((log) => {
    const matchesType = filter === 'all' || log.type === filter;
    const matchesSearch = searchTerm === '' || log.message.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesType && matchesSearch;
  });

  const handleCopy = () => {
    const text = logs.logs.map((log) => `[${log.timestamp}] [${log.type.toUpperCase()}] ${log.message}`).join('\n');
    navigator.clipboard.writeText(text);
  };

  const handleDownload = () => {
    const text = logs.logs.map((log) => `[${log.timestamp}] [${log.type.toUpperCase()}] ${log.message}`).join('\n');
    const element = document.createElement('a');
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
    element.setAttribute('download', `execution-logs-${new Date().getTime()}.log`);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleClear = () => {
    setSearchTerm('');
    setFilter('all');
  };

  const getLogTypeColor = (type: 'stdout' | 'stderr' | 'system') => {
    switch (type) {
      case 'stdout':
        return 'text-green-600 dark:text-green-400';
      case 'stderr':
        return 'text-red-600 dark:text-red-400';
      case 'system':
        return 'text-blue-600 dark:text-blue-400';
      default:
        return 'text-foreground';
    }
  };

  const getLogTypeBadge = (type: 'stdout' | 'stderr' | 'system') => {
    switch (type) {
      case 'stdout':
        return <Badge variant="secondary" className="text-xs bg-green-600/20 text-green-700 dark:text-green-400">OUT</Badge>;
      case 'stderr':
        return <Badge variant="secondary" className="text-xs bg-red-600/20 text-red-700 dark:text-red-400">ERR</Badge>;
      case 'system':
        return <Badge variant="secondary" className="text-xs bg-blue-600/20 text-blue-700 dark:text-blue-400">SYS</Badge>;
      default:
        return null;
    }
  };

  return (
    <div className="border rounded-lg bg-muted/30 overflow-hidden">
      {/* Header */}
      <div className="bg-muted/50 px-4 py-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="hover:bg-accent rounded p-1 transition-colors"
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-0' : '-rotate-90'}`}
            />
          </button>
          <h3 className="font-semibold text-sm">Terminal Output</h3>
          {isExecuting && (
            <Badge variant="default" className="text-xs gap-1 bg-blue-600 hover:bg-blue-700">
              <span className="inline-block h-2 w-2 bg-white rounded-full animate-pulse"></span>
              Executing
            </Badge>
          )}
          {logs.exitCode !== undefined && (
            <Badge 
              variant="default" 
              className={`text-xs ${logs.exitCode === 0 ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
            >
              Exit Code: {logs.exitCode}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 transition-all duration-200 hover:scale-110 hover:bg-accent"
            onClick={handleCopy}
            title="Copy all logs"
          >
            <Copy className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 transition-all duration-200 hover:scale-110 hover:bg-accent"
            onClick={handleDownload}
            title="Download logs"
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-destructive hover:text-destructive transition-all duration-200 hover:scale-110"
            onClick={handleClear}
            title="Clear filters"
            disabled={filter === 'all' && searchTerm === ''}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isExpanded && (
        <>
          {/* Filter Bar */}
          <div className="bg-background/50 px-4 py-2 border-b space-y-2">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <div className="flex items-center gap-1 flex-wrap">
                {(['all', 'stdout', 'stderr', 'system'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => setFilter(type)}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                      filter === type
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    {type === 'all' ? 'All' : type === 'stdout' ? 'Output' : type === 'stderr' ? 'Errors' : 'System'}
                    {logs.logs.filter((l) => l.type === type).length > 0 && (
                      <span className="ml-1 text-[10px]">({logs.logs.filter((l) => l.type === type).length})</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative">
              <Input
                placeholder="Search logs..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pr-8 h-8 text-xs"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 hover:bg-muted rounded p-1 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {/* Logs Display */}
          <ScrollArea className={`${maxHeight} font-mono text-xs`}>
            <div className="p-3 space-y-0">
              {filteredLogs.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">No logs match the filter</p>
              ) : (
                filteredLogs.map((log, index) => (
                  <div key={index} className="flex flex-col hover:bg-white/10 px-2 py-1 rounded transition-colors group">
                    <span className="text-muted-foreground text-[10px]">
                      {log.timestamp}
                    </span>
                    <div className="flex gap-2">
                      <div className="flex-shrink-0">
                        {getLogTypeBadge(log.type)}
                      </div>
                      <span className={`flex-1 break-words ${getLogTypeColor(log.type)} font-semibold`}>
                        {log.message}
                      </span>
                    </div>
                  </div>
                ))
              )}
              <div ref={scrollRef} />
            </div>
          </ScrollArea>

          {/* Footer with stats */}
          <div className="bg-muted/50 px-4 py-2 border-t text-xs text-muted-foreground flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span>
                Total Lines: <span className="font-semibold">{logs.logs.length}</span>
              </span>
              <span>
                Displayed: <span className="font-semibold">{filteredLogs.length}</span>
              </span>
              {logs.duration && (
                <span>
                  Duration: <span className="font-semibold">{(logs.duration / 1000).toFixed(2)}s</span>
                </span>
              )}
            </div>
            {logs.startTime && (
              <span className="text-[10px]">
                Started: {new Date(logs.startTime).toLocaleString()}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

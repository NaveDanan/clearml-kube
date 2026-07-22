'use client';

import { AvatarStack } from '@/components/kibo-ui/avatar-stack';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useOnlineCollaborators, useCollaboration, type Collaborator } from './collaboration-context';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Wifi, WifiOff, Crown, Shield } from 'lucide-react';

interface CollaboratorAvatarsProps {
  className?: string;
  maxVisible?: number;
  size?: number;
}

function getInitials(name: string, email: string): string {
  if (name && name.trim()) {
    const parts = name.split(' ').filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }
  if (email) {
    return email.substring(0, 2).toUpperCase();
  }
  return 'U';
}

function getRoleBadge(role?: string) {
  if (role === 'manager') {
    return { icon: Crown, label: 'Pipeline Manager', color: 'text-amber-500' };
  }
  if (role === 'supervisor') {
    return { icon: Shield, label: 'Supervisor', color: 'text-blue-500' };
  }
  return null;
}

export function CollaboratorAvatars({ 
  className, 
  maxVisible = 5,
  size = 32,
}: CollaboratorAvatarsProps) {
  const collaborators = useOnlineCollaborators();
  const { isConnected, isShareCanvasEnabled, currentUserId } = useCollaboration();

  // Only show connection indicator if Share Canvas is enabled
  if (!isShareCanvasEnabled) {
    return null;
  }

  // Show connection indicator even if no other collaborators
  if (collaborators.length === 0 && !isConnected) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={cn('flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50', className)}>
              <WifiOff className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Offline</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <span>Not connected to collaboration server</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const visibleCollaborators = collaborators.slice(0, maxVisible);
  const hiddenCount = collaborators.length - maxVisible;

  return (
    <TooltipProvider>
      <div className={cn('flex items-center gap-2', className)}>
        {/* Connection status indicator */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center">
              {isConnected ? (
                <Wifi className="w-4 h-4 text-green-500" />
              ) : (
                <WifiOff className="w-4 h-4 text-muted-foreground" />
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <span>{isConnected ? 'Connected - Real-time sync active' : 'Disconnected'}</span>
          </TooltipContent>
        </Tooltip>

        {collaborators.length > 0 && (
          <AvatarStack animate size={size}>
            {visibleCollaborators.map((collaborator) => (
              <Tooltip key={collaborator.id}>
                <TooltipTrigger asChild>
                  <Avatar
                    className="border-2 cursor-pointer"
                    style={{ borderColor: collaborator.color }}
                  >
                    <AvatarImage 
                      src={collaborator.avatarUrl} 
                      alt={collaborator.name} 
                    />
                    <AvatarFallback 
                      className="text-xs font-medium"
                      style={{ backgroundColor: `${collaborator.color}20`, color: collaborator.color }}
                    >
                      {getInitials(collaborator.name, collaborator.email)}
                    </AvatarFallback>
                  </Avatar>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="flex flex-col gap-0.5">
                  <span className="font-medium flex items-center gap-1">
                    {collaborator.name}
                    {collaborator.id === currentUserId && ' (You)'}
                    {getRoleBadge(collaborator.role) && (
                      <span className={cn('ml-1', getRoleBadge(collaborator.role)!.color)}>
                        {(() => {
                          const RoleIcon = getRoleBadge(collaborator.role)!.icon;
                          return <RoleIcon className="w-3 h-3" />;
                        })()}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">{collaborator.email}</span>
                  {collaborator.role && (
                    <span className="text-xs text-muted-foreground">
                      {collaborator.role === 'manager' ? 'Pipeline Manager' : 
                       collaborator.role === 'supervisor' ? 'Supervisor' : 'Member'}
                    </span>
                  )}
                  <span className="text-xs flex items-center gap-1">
                    <span 
                      className="w-2 h-2 rounded-full bg-green-500 animate-pulse"
                    />
                    Online
                  </span>
                </TooltipContent>
              </Tooltip>
            ))}
            
            {hiddenCount > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Avatar className="border-2 border-muted-foreground cursor-pointer">
                    <AvatarFallback className="text-xs font-medium bg-muted">
                      +{hiddenCount}
                    </AvatarFallback>
                  </Avatar>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <span>{hiddenCount} more collaborator{hiddenCount > 1 ? 's' : ''}</span>
                </TooltipContent>
              </Tooltip>
            )}
          </AvatarStack>
        )}

        {collaborators.length > 1 && (
          <span className="text-xs text-muted-foreground hidden sm:inline">
            {collaborators.length} online
          </span>
        )}
      </div>
    </TooltipProvider>
  );
}

export default CollaboratorAvatars;

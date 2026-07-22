'use client';

import { useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Icon } from "@iconify/react";
import { useAuth } from "@/lib/supabase/use-auth";
import { ControlledSettingsDialog } from "@/components/ui/settings-dialog";
import { ProfileDialog } from "@/components/ui/profile-dialog";
import { ShareCanvasDialog } from "@/components/ui/share-canvas-dialog";
import { useCollaboration, usePermissions } from "@/components/collaboration";

interface UserDropdownProps {
  className?: string;
}

export function UserDropdown({ className }: UserDropdownProps) {
  const { user, loading, signOut } = useAuth();
  const { setShareCanvasEnabled } = useCollaboration();
  const { currentUserRole, isOwner } = usePermissions();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'appearance' | 'connections' | 'secrets'>('appearance');

  // Generate initials from user name or email
  const getInitials = (name?: string, email?: string) => {
    if (name) {
      const parts = name.split(' ');
      if (parts.length >= 2) {
        return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
      }
      return name.substring(0, 2).toUpperCase();
    }
    if (email) {
      return email.substring(0, 2).toUpperCase();
    }
    return 'U';
  };

  const handleAction = (action: string) => {
    switch (action) {
      case 'profile':
        setProfileOpen(true);
        break;
      case 'settings':
        setSettingsTab('appearance');
        setSettingsOpen(true);
        break;
      case 'connections':
        setSettingsTab('connections');
        setSettingsOpen(true);
        break;
      case 'secrets':
        setSettingsTab('secrets');
        setSettingsOpen(true);
        break;
      case 'share':
        setShareOpen(true);
        break;
      case 'logout':
        signOut();
        break;
      default:
        break;
    }
  };

  const menuItems = {
    profile: [
      { icon: "solar:user-circle-line-duotone", label: "Profile", action: "profile" },
      { icon: "solar:settings-line-duotone", label: "Settings", action: "settings" },
      { icon: "solar:share-circle-line-duotone", label: "Share Canvas", action: "share", badge: "Beta" },
    ],
    account: [
      { icon: "solar:logout-2-bold-duotone", label: "Log out", action: "logout" },
    ],
  };

  const renderMenuItem = (item: typeof menuItems.profile[0], index: number) => (
    <DropdownMenuItem 
      key={index}
      className="p-2 rounded-lg cursor-pointer"
      onClick={() => handleAction(item.action)}
    >
      <span className="flex items-center gap-2 font-medium flex-1">
        <Icon
          icon={item.icon}
          className="size-5 text-muted-foreground"
        />
        {item.label}
      </span>
      {item.badge && (
        <Badge className="ml-auto bg-green-500/20 text-green-500 border-green-500/30 text-[10px] px-1.5 py-0 h-4 hover:bg-green-500/30">
          {item.badge}
        </Badge>
      )}
    </DropdownMenuItem>
  );

  if (loading) {
    return (
      <Avatar className={cn("cursor-pointer size-8 border", className)}>
        <AvatarFallback className="animate-pulse">...</AvatarFallback>
      </Avatar>
    );
  }

  const displayName = user?.name || user?.email?.split('@')[0] || 'User';
  const initials = getInitials(user?.name, user?.email);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Avatar className={cn("cursor-pointer size-8 border border-border hover:border-primary/50 transition-colors", className)}>
            <AvatarImage src={user?.avatarUrl} alt={displayName} />
            <AvatarFallback className="text-xs font-medium">{initials}</AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>

        <DropdownMenuContent className="w-[280px] rounded-xl p-1" align="end">
          <section className="bg-card rounded-lg p-1">
            {/* User Info Header */}
            <div className="flex items-center gap-3 p-2">
              <Avatar className="size-10 border">
                <AvatarImage src={user?.avatarUrl} alt={displayName} />
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-sm truncate">{displayName}</h3>
                <p className="text-muted-foreground text-xs truncate">{user?.email}</p>
              </div>
              <Badge variant="secondary" className="text-[10px] rounded-sm">
                Online
              </Badge>
            </div>

            <DropdownMenuSeparator />

            {/* Profile Menu Items */}
            <DropdownMenuGroup>
              {menuItems.profile.map(renderMenuItem)}
            </DropdownMenuGroup>

            <DropdownMenuSeparator />

            {/* Account Menu Items */}
            <DropdownMenuGroup>
              {menuItems.account.map(renderMenuItem)}
            </DropdownMenuGroup>
          </section>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Settings Dialog */}
      <ControlledSettingsDialog 
        open={settingsOpen} 
        onOpenChange={setSettingsOpen}
        defaultTab={settingsTab}
      />

      {/* Profile Dialog */}
      <ProfileDialog
        open={profileOpen}
        onOpenChange={setProfileOpen}
        user={user}
      />

      {/* Share Canvas Dialog */}
      <ShareCanvasDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        onShareCanvasEnabledChange={setShareCanvasEnabled}
        currentUserRole={currentUserRole}
        isOwner={isOwner}
      />
    </>
  );
}

export default UserDropdown;

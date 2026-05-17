'use client';

/**
 * Small dropdown that exposes the Install MCP and Start MCP dialogs.
 *
 * Rendered in the header regardless of login state — the dev-API session
 * model doesn't require OIDC, so a logged-out visitor can still pair with
 * an MCP client. Save/Publish remains login-gated separately.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Terminal, Download } from 'lucide-react';
import { StartMcpDialog } from './StartMcpDialog';
import { InstallMcpDialog } from './InstallMcpDialog';

export function McpMenu() {
  const [showStartMcp, setShowStartMcp] = useState(false);
  const [showInstallMcp, setShowInstallMcp] = useState(false);
  const devApiEnabled = process.env.NEXT_PUBLIC_DEV_API === '1';

  if (!devApiEnabled) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='ghost' size='sm' className='gap-1.5 text-sm font-medium'>
            <Terminal className='size-4' /> MCP
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='min-w-[160px]'>
          <DropdownMenuItem onClick={() => setShowInstallMcp(true)} className='gap-2'>
            <Download /> Install MCP
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setShowStartMcp(true)} className='gap-2'>
            <Terminal /> Start MCP
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <StartMcpDialog open={showStartMcp} onOpenChange={setShowStartMcp} />
      <InstallMcpDialog open={showInstallMcp} onOpenChange={setShowInstallMcp} />
    </>
  );
}

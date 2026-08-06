'use client';

/**
 * One-time installation instructions for hooking the mvs-mcp server into
 * Claude Desktop. Shown from the avatar dropdown alongside Start MCP. The
 * MVS_DEV_URL placeholder is auto-filled from window.location.origin so the
 * snippet works out of the box on whatever deploy a user is browsing.
 */

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

interface InstallMcpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MCP_SOURCE_HINT = 'Get the mvs-mcp source from the project repository, then build it locally:';

const BUILD_STEPS = `git clone <mvs-mcp repository URL>
cd mvs-mcp/mcp-server
npm install
npm run build
# note the absolute path to dist/index.js — you'll paste it below`;

function configFor(baseUrl: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        mvs: {
          command: 'node',
          args: ['/absolute/path/to/mvs-mcp/mcp-server/dist/index.js'],
          env: {
            MVS_DEV_URL: baseUrl,
          },
        },
      },
    },
    null,
    2
  );
}

export function InstallMcpDialog({ open, onOpenChange }: InstallMcpDialogProps) {
  const baseUrl = useMemo(() => {
    if (typeof window === 'undefined') return 'https://your-domain';
    const prefix = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
    return `${window.location.origin}${prefix}`;
  }, []);
  const snippet = useMemo(() => configFor(baseUrl), [baseUrl]);
  const [, setTick] = useState(0); // force-rerender on copy for the toast

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
      setTick((n) => n + 1);
    } catch {
      toast.error('Clipboard blocked — select and copy manually');
    }
  };

  const configPath =
    typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
      ? '~/Library/Application Support/Claude/claude_desktop_config.json'
      : typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('win')
        ? '%APPDATA%\\Claude\\claude_desktop_config.json'
        : '~/.config/Claude/claude_desktop_config.json';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[640px] max-h-[85vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>Install MCP in Claude Desktop</DialogTitle>
          <DialogDescription>
            One-time setup. After this, use <strong>Start MCP</strong> each time you want to connect a new Claude
            conversation to this editor.
          </DialogDescription>
        </DialogHeader>

        <ol className='list-decimal pl-5 space-y-4 text-sm'>
          <li>
            <p className='mb-2'>{MCP_SOURCE_HINT}</p>
            <div className='flex items-center justify-between mb-1'>
              <span className='text-xs text-muted-foreground'>Run in a terminal:</span>
              <Button size='sm' variant='outline' onClick={() => copy(BUILD_STEPS, 'Commands')}>
                Copy
              </Button>
            </div>
            <Textarea readOnly rows={5} value={BUILD_STEPS} className='font-mono text-xs' />
          </li>

          <li>
            <p className='mb-2'>
              Add this entry to <code className='text-xs'>{configPath}</code> (create the file if it doesn&apos;t
              exist). Replace the <code>args</code> path with the absolute path to your built <code>dist/index.js</code>
              .
            </p>
            <div className='flex items-center justify-end mb-1'>
              <Button size='sm' variant='outline' onClick={() => copy(snippet, 'Config')}>
                Copy
              </Button>
            </div>
            <Textarea readOnly rows={12} value={snippet} className='font-mono text-xs' />
            <p className='text-xs text-muted-foreground mt-1'>
              If you already have <code>mcpServers</code> entries, merge the <code>mvs</code> key into your existing
              object rather than replacing the file.
            </p>
          </li>

          <li>Quit and re-open Claude Desktop. It picks up MCP servers only on startup.</li>

          <li>
            Back here, open <strong>Start MCP</strong> from the same menu, copy the prompt, paste it into a Claude
            conversation. From then on, Claude can drive this editor for you.
          </li>
        </ol>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

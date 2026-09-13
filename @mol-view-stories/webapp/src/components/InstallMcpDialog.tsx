'use client';

/**
 * One-time setup for connecting an AI agent to this editor.
 *
 * The MCP server is hosted by this deployment at /api/mcp, so setup is a single
 * command with a URL in it — there is nothing to clone, build, or keep in sync,
 * and no absolute paths to paste into a JSON file. The URL is derived from
 * window.location so the snippet is correct on whatever deploy is being viewed.
 *
 * The stdio bridge shown under "other clients" exists only for clients that
 * cannot speak Streamable HTTP; it forwards to the very same endpoint.
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

function desktopConfig(mcpUrl: string): string {
  return JSON.stringify({ mcpServers: { mvs: { type: 'http', url: mcpUrl } } }, null, 2);
}

export function InstallMcpDialog({ open, onOpenChange }: InstallMcpDialogProps) {
  const mcpUrl = useMemo(() => {
    if (typeof window === 'undefined') return 'https://your-domain/api/mcp/';
    const prefix = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
    return `${window.location.origin}${prefix}/api/mcp/`;
  }, []);

  const [showAdvanced, setShowAdvanced] = useState(false);

  const claudeCode = `claude mcp add --transport http mvs ${mcpUrl}`;
  const desktop = desktopConfig(mcpUrl);

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error('Clipboard blocked — select and copy manually');
    }
  };

  const configPath =
    typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')
      ? '~/Library/Application Support/Claude/claude_desktop_config.json'
      : typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows')
        ? '%APPDATA%\\Claude\\claude_desktop_config.json'
        : '~/.config/Claude/claude_desktop_config.json';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[640px] max-h-[85vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>Connect an AI agent</DialogTitle>
          <DialogDescription>
            This editor hosts its own MCP server. One command, then ask Claude to build you a story — it will send back
            a link that pairs your editor with the conversation.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-5 text-sm'>
          <div>
            <div className='flex items-center justify-between mb-1'>
              <span className='font-medium'>Claude Code</span>
              <Button size='sm' variant='outline' onClick={() => copy(claudeCode, 'Command')}>
                Copy
              </Button>
            </div>
            <Textarea readOnly rows={2} value={claudeCode} className='font-mono text-xs' />
            <p className='text-xs text-muted-foreground mt-1'>Run it once, in any terminal. That is the whole setup.</p>
          </div>

          <div>
            <div className='flex items-center justify-between mb-1'>
              <span className='font-medium'>Claude Desktop</span>
              <Button size='sm' variant='outline' onClick={() => copy(desktop, 'Config')}>
                Copy
              </Button>
            </div>
            <p className='text-xs text-muted-foreground mb-1'>
              Merge into <code className='text-xs'>{configPath}</code>, then restart the app — it reads MCP servers only
              at startup.
            </p>
            <Textarea readOnly rows={9} value={desktop} className='font-mono text-xs' />
          </div>

          <div className='rounded-md border bg-muted/40 p-3'>
            <p className='font-medium mb-1'>Then just ask</p>
            <p className='text-muted-foreground'>
              &ldquo;Build me a story about the structure of haemoglobin.&rdquo; Claude reads its own instructions from
              the server, and its first move is to hand you a link. Open it and watch the scenes appear.
            </p>
          </div>

          <div>
            <button
              type='button'
              className='text-xs text-muted-foreground underline underline-offset-2'
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? 'Hide' : 'Show'} other clients and options
            </button>
            {showAdvanced && (
              <div className='mt-3 space-y-3 text-xs text-muted-foreground'>
                <p>
                  <strong>Clients without Streamable HTTP support</strong> can use the stdio bridge in the repo&apos;s{' '}
                  <code>@mol-view-stories/mcp-server</code> package. Build it with{' '}
                  <code>pnpm --filter @mol-view-stories/mcp-server build</code> and run <code>node dist/index.js</code>{' '}
                  with <code>MVS_DEV_URL</code> set to <code>{mcpUrl.replace(/\/api\/mcp\/$/, '')}</code>. It forwards
                  to the same endpoint, so the tools are identical.
                </p>
                <p>
                  <strong>Pinning one story across conversations.</strong> By default each new conversation gets a
                  fresh, empty story. To keep returning to the same one, take a token from <em>Start MCP</em> and
                  install with <code>--header &quot;Authorization: Bearer &lt;token&gt;&quot;</code>.
                </p>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

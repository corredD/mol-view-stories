'use client';

/**
 * Start MCP dialog
 *
 * Hands the user a session token to paste into a Claude prompt so Claude's
 * `auth_set` MCP tool can attach it to every subsequent dev-API call. The
 * token is the same session ID this browser tab is using, so both ends share
 * the in-memory editing slot on the server.
 *
 * No login required — sessions are minted anonymously on first visit and
 * cached in localStorage. Refresh mints a new one (invalidating the old).
 */

import { useCallback, useEffect, useState } from 'react';
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
import { clearSession, ensureSession } from '@/lib/dev-session';
import { toast } from 'sonner';

interface StartMcpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function StartMcpDialog({ open, onOpenChange }: StartMcpDialogProps) {
  const [token, setToken] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (mintFresh: boolean) => {
    setLoading(true);
    try {
      if (mintFresh) clearSession();
      const id = await ensureSession();
      setToken(id);
    } catch {
      toast.error('Could not mint session — is the dev API enabled?');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load(false);
  }, [open, load]);

  const prompt = token ? `Use this MCP token: ${token}` : '';

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error('Clipboard blocked — select and copy manually');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[560px]'>
        <DialogHeader>
          <DialogTitle>Start MCP</DialogTitle>
          <DialogDescription>
            Paste this prompt into a Claude conversation that has the mol-view-stories
            MCP server enabled. Claude will call <code>auth_set</code> once and then drive
            this editor for the rest of the chat. The token is tied to this browser tab —
            both ends share the same editing slot on the server.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-3'>
          <div>
            <div className='flex items-center justify-between mb-1'>
              <label className='text-sm font-medium'>Paste this into Claude</label>
              <Button size='sm' variant='outline' disabled={!token} onClick={() => copy(prompt, 'Prompt')}>
                Copy
              </Button>
            </div>
            <Textarea
              readOnly
              rows={3}
              value={prompt || (loading ? 'Loading…' : '')}
              className='font-mono text-xs'
            />
          </div>

          <div>
            <div className='flex items-center justify-between mb-1'>
              <label className='text-sm font-medium'>Raw token</label>
              <Button size='sm' variant='outline' disabled={!token} onClick={() => copy(token, 'Token')}>
                Copy token
              </Button>
            </div>
            <Textarea readOnly rows={2} value={token} className='font-mono text-xs break-all' />
            <p className='text-xs text-muted-foreground mt-1'>
              Anyone with this token can drive your editing slot, so don't share screenshots.
              The session lasts up to 24h idle; click <strong>New session</strong> to invalidate
              and rotate.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => load(true)} disabled={loading}>
            New session
          </Button>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

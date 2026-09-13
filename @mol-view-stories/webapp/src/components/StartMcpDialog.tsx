'use client';

/**
 * Start MCP dialog — the manual pairing fallback.
 *
 * Normally nobody needs this. An agent connected to /api/mcp gets its own
 * session and calls `editor_open`, which hands the user a link that pairs this
 * tab with that conversation; nothing is copied by hand.
 *
 * This dialog covers the other direction: taking *this tab's* session token and
 * pinning a client to it, so the same story comes back in every new
 * conversation. Install the server with
 * `--header "Authorization: Bearer <token>"` and it will always use this slot.
 *
 * No login required — sessions are minted anonymously on first visit and
 * cached in localStorage. "New session" mints a fresh one, invalidating the old.
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

  // What the user actually needs is an install command carrying the token, not
  // a sentence to paste into a chat — pinning happens at install time now.
  const prompt = token
    ? `claude mcp add --transport http mvs ${typeof window !== 'undefined' ? `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}` : ''}/api/mcp/ --header "Authorization: Bearer ${token}"`
    : '';

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
          <DialogTitle>Pin this editing session</DialogTitle>
          <DialogDescription>
            You usually don&apos;t need this. Just ask a connected agent to build something — it will send you a link
            that pairs this tab with the conversation automatically. Use the token below only if you want <em>every</em>{' '}
            new conversation to reopen this same story.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-3'>
          <div>
            <div className='flex items-center justify-between mb-1'>
              <label className='text-sm font-medium'>Install pinned to this session</label>
              <Button size='sm' variant='outline' disabled={!token} onClick={() => copy(prompt, 'Command')}>
                Copy
              </Button>
            </div>
            <Textarea readOnly rows={3} value={prompt || (loading ? 'Loading…' : '')} className='font-mono text-xs' />
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
              Anyone with this token can drive your editing slot, so don&apos;t share screenshots. The session lasts up
              to 24h idle; click <strong>New session</strong> to invalidate and rotate.
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

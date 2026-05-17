'use client';

/**
 * Start MCP dialog
 *
 * Hands the user a short-lived bearer token to paste into a Claude prompt so
 * Claude's `auth_set` MCP tool can authenticate that conversation against this
 * user's editing slot on the server. The token here is the raw OIDC
 * access_token (lifetime ~1h). Long-term this becomes a long-lived pairing
 * token minted by Flask; the UI contract here doesn't change.
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
import { getValidTokens } from '@/lib/auth/token-manager';
import { toast } from 'sonner';

interface StartMcpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function StartMcpDialog({ open, onOpenChange }: StartMcpDialogProps) {
  const [token, setToken] = useState<string>('');
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const t = await getValidTokens();
      if (t?.access_token) {
        setToken(t.access_token);
        setExpiresAt(t.expires_at ?? null);
      } else {
        setToken('');
        setExpiresAt(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const prompt = token ? `Use this MCP token: ${token}` : '';

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error('Clipboard blocked — select and copy manually');
    }
  };

  const expiresIn = expiresAt
    ? Math.max(0, Math.floor((expiresAt - Date.now()) / 60_000))
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[560px]'>
        <DialogHeader>
          <DialogTitle>Start MCP</DialogTitle>
          <DialogDescription>
            Paste this prompt into a Claude conversation that has the mol-view-stories
            MCP server enabled. Claude will call <code>auth_set</code> once and then drive
            this editor for the rest of the chat.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-3'>
          <div>
            <div className='flex items-center justify-between mb-1'>
              <label className='text-sm font-medium'>Paste this into Claude</label>
              <Button
                size='sm'
                variant='outline'
                disabled={!token}
                onClick={() => copy(prompt, 'Prompt')}
              >
                Copy
              </Button>
            </div>
            <Textarea
              readOnly
              rows={3}
              value={prompt || (loading ? 'Loading…' : 'Not logged in')}
              className='font-mono text-xs'
            />
          </div>

          <div>
            <div className='flex items-center justify-between mb-1'>
              <label className='text-sm font-medium'>Raw token</label>
              <Button
                size='sm'
                variant='outline'
                disabled={!token}
                onClick={() => copy(token, 'Token')}
              >
                Copy token
              </Button>
            </div>
            <Textarea readOnly rows={3} value={token} className='font-mono text-xs break-all' />
            {expiresIn !== null && (
              <p className='text-xs text-muted-foreground mt-1'>
                Expires in ~{expiresIn} min. Click Refresh below to issue a new one when it
                runs out and re-paste it into Claude.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={refresh} disabled={loading}>
            Refresh
          </Button>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  ECP_METHOD_NOT_FOUND,
  ecpError,
  ecpSuccess,
  ecpTransportError,
  isAllowedWindowOpenUrl,
  originOf,
  parseEcpMessage,
  readEcpError,
  readEcpOrder,
  type EcpErrorDetail,
  type EcpOrder,
} from '@/lib/ucp/ecp';
import type { EmbeddedCheckoutSession } from '@/context/EmbeddedCheckoutContext';

export type EcpStatus = 'connecting' | 'active' | 'complete' | 'error';

export interface PendingWindowOpen {
  id: string | number;
  url: string;
}

interface UseEcpSessionOptions {
  session: EmbeddedCheckoutSession;
  iframe: RefObject<HTMLIFrameElement | null>;
  /** Called once when the embedded checkout reports `ec.complete`. */
  onComplete: (order: EcpOrder | null) => void;
}

/**
 * Host side of an ECP session.
 *
 * Owns the JSON-RPC 2.0 exchange with the embedded checkout: answers the
 * `ec.ready` handshake (checkout renders nothing until it is answered), tracks
 * lifecycle notifications, and parks `ec.window.open_request` until the buyer
 * decides. Every inbound message is validated against the `continue_url` origin
 * AND the iframe's window before it is trusted.
 */
export function useEcpSession({ session, iframe, onComplete }: UseEcpSessionOptions) {
  const { version } = session;
  const expectedOrigin = originOf(session.continueUrl);

  const [status, setStatus] = useState<EcpStatus>(expectedOrigin ? 'connecting' : 'error');
  const [order, setOrder] = useState<EcpOrder | null>(null);
  const [error, setError] = useState<EcpErrorDetail | null>(
    expectedOrigin
      ? null
      : { code: 'invalid_continue_url', content: 'The merchant checkout URL is invalid.' }
  );
  const [pendingWindow, setPendingWindow] = useState<PendingWindowOpen | null>(null);

  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const post = useCallback(
    (message: unknown) => {
      if (!expectedOrigin) return;
      iframe.current?.contentWindow?.postMessage(message, expectedOrigin);
    },
    [expectedOrigin, iframe]
  );

  useEffect(() => {
    if (!expectedOrigin) return;

    const handleMessage = (event: MessageEvent) => {
      // Strict origin validation: only the merchant checkout may talk to us.
      if (event.origin !== expectedOrigin) return;
      if (!iframe.current || event.source !== iframe.current.contentWindow) return;

      const message = parseEcpMessage(event.data);
      if (!message) return;

      const { id, params } = message;

      switch (message.method) {
        case 'ec.ready': {
          if (id === undefined) return;
          // Merchants may request authorization mid-handshake. Emporika has no
          // buyer identity to hand over, so fail the handshake instead of
          // pretending to authenticate; the caller falls back to a redirect.
          if (params?.auth) {
            post(
              ecpError(
                id,
                version,
                'not_supported_error',
                'Emporika cannot provide checkout credentials.',
                'unrecoverable'
              )
            );
            setError({
              code: 'not_supported_error',
              content: 'This checkout requires account credentials Emporika cannot provide.',
            });
            setStatus('error');
            return;
          }
          post(ecpSuccess(id, version));
          setStatus('active');
          return;
        }

        case 'ec.auth': {
          // The merchant asks for authorization after the handshake. Emporika
          // has no buyer identity to supply, so decline rather than stall.
          if (id === undefined) return;
          post(
            ecpError(
              id,
              version,
              'not_supported_error',
              'Emporika cannot provide checkout credentials.',
              'unrecoverable'
            )
          );
          setError({
            code: 'not_supported_error',
            content: 'This checkout requires account credentials Emporika cannot provide.',
          });
          setStatus('error');
          return;
        }

        case 'ec.start':
        case 'ec.line_items.change':
        case 'ec.buyer.change':
        case 'ec.messages.change':
        case 'ec.totals.change':
        case 'ec.payment.change':
        case 'ec.fulfillment.change':
          // Informational notifications — the merchant UI already reflects them.
          return;

        case 'ec.complete': {
          const completedOrder = readEcpOrder(params);
          setOrder(completedOrder);
          setStatus('complete');
          onCompleteRef.current(completedOrder);
          return;
        }

        case 'ec.error': {
          setError(readEcpError(params));
          setStatus('error');
          return;
        }

        case 'ec.window.open_request': {
          if (id === undefined) return;
          const url = params?.url;
          if (!isAllowedWindowOpenUrl(url)) {
            post(
              ecpError(
                id,
                version,
                'window_open_rejected_error',
                'Only HTTPS links can be opened.',
                'unrecoverable'
              )
            );
            return;
          }
          // Park the request: the buyer must confirm before anything opens.
          setPendingWindow({ id, url });
          return;
        }

        default:
          // Payment/address delegations were never requested, so any other
          // request is unexpected. Answer it rather than leaving checkout hanging.
          if (id !== undefined) {
            post(
              ecpTransportError(id, ECP_METHOD_NOT_FOUND, 'Method not supported by Emporika.')
            );
          }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [expectedOrigin, iframe, post, version]);

  /** Buyer decision for the parked `ec.window.open_request`. */
  const answerWindowOpen = useCallback(
    (open: boolean) => {
      if (!pendingWindow) return;
      if (open) {
        window.open(pendingWindow.url, '_blank', 'noopener,noreferrer');
      }
      post(
        open
          ? ecpSuccess(pendingWindow.id, version)
          : ecpError(
              pendingWindow.id,
              version,
              'abort_error',
              'The buyer closed the link without opening it.',
              'recoverable'
            )
      );
      setPendingWindow(null);
    },
    [pendingWindow, post, version]
  );

  return { status, order, error, pendingWindow, answerWindowOpen };
}

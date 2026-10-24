import type { IngestedAlert } from './ingestion.js';

const COOLDOWN_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

export function createAlertDispatcher(webhookUrl?: string) {
  const cooldowns = new Map<string, number>();

  return async function dispatchAlert(alert: IngestedAlert): Promise<void> {
    if (!webhookUrl) return;

    const now = Date.now();
    for (const [fingerprint, sentAt] of cooldowns) {
      if (now - sentAt >= COOLDOWN_MS) cooldowns.delete(fingerprint);
    }
    const lastAlert = cooldowns.get(alert.fingerprint);
    if (lastAlert !== undefined && now - lastAlert < COOLDOWN_MS) return;

    cooldowns.set(alert.fingerprint, now);
    const isDiscord = new URL(webhookUrl).hostname === 'discord.com'
      && new URL(webhookUrl).pathname.startsWith('/api/webhooks/');
    const isNtfy = new URL(webhookUrl).hostname === 'ntfy.sh';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      let response: Response;
      if (isDiscord) {
        response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            embeds: [{
              title: `[${alert.service.toUpperCase()}] ${alert.title}`.slice(0, 256),
              description: `**Culprit:** \`${alert.culprit}\`\n**Message:** ${alert.message.slice(0, 3000)}`,
              color: alert.level === 'fatal' ? 0xff0000 : 0xffa500,
              footer: { text: `Fingerprint: ${alert.fingerprint.slice(0, 12)}` },
            }],
          }),
        });
      } else if (isNtfy) {
        response = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            Title: `[${alert.service}] ${alert.title}`.slice(0, 250),
            Priority: alert.level === 'fatal' ? 'urgent' : 'high',
            Tags: 'warning,bug',
          },
          signal: controller.signal,
          body: `Culprit: ${alert.culprit}\n${alert.message}`.slice(0, 4096),
        });
      } else {
        response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify(alert),
        });
      }

      if (!response.ok) {
        cooldowns.delete(alert.fingerprint);
        console.error(`[AlertDispatcher] Webhook returned HTTP ${response.status}`);
      }
    } catch (error) {
      cooldowns.delete(alert.fingerprint);
      console.error('[AlertDispatcher] Failed to dispatch webhook notification:', error);
    } finally {
      clearTimeout(timeout);
    }
  };
}

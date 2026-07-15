import { Hono } from 'hono';
import type { OnAppInstallRequest, TriggerResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createPost } from '../core/post';

export const triggers = new Hono();

triggers.post('/on-app-install', async (c) => {
  // Parse the trigger body BEFORE creating the post. If createPost() succeeds we
  // must never return an error: Devvit retries the install on a non-2xx response,
  // which would create a DUPLICATE game post. A missing/malformed body is not a
  // reason to fail the install — degrade to an unknown trigger type.
  let triggerType = 'AppInstall';
  try {
    triggerType = (await c.req.json<OnAppInstallRequest>()).type;
  } catch {
    /* body is optional; keep the default type */
  }
  try {
    const post = await createPost();
    return c.json<TriggerResponse>(
      {
        status: 'success',
        message: `Post created in subreddit ${context.subredditName} with id ${post.id} (trigger: ${triggerType})`,
      },
      200
    );
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json<TriggerResponse>(
      {
        status: 'error',
        message: 'Failed to create post',
      },
      400
    );
  }
});

const crypto = require('crypto');

const SPACE =
  'https://zerogpu-aoti-wan2-2-fp8da-aoti-faster.hf.space';

async function startWan22({ tasks, file, prompt, seconds }) {
  if (!file?.buffer) {
    throw new Error('Wan 2.2 requires an uploaded reference image.');
  }

  const id = crypto.randomUUID();

  const task = {
    provider: 'wan22',
    status: 'processing',
    progress: 5,
    url: null,
    error: null,
    createdAt: Date.now()
  };

  tasks.set(id, task);

  // Run generation asynchronously; the API returns the task ID immediately.
  (async () => {
    try {
      const { Client, handle_file } = await import('@gradio/client');

      const client = await Client.connect(SPACE);

      const blob = new Blob(
        [file.buffer],
        { type: file.mimetype || 'image/jpeg' }
      );

      const duration = Math.min(
        5,
        Math.max(0.5, Number(seconds) || 3.5)
      );

      task.progress = 15;

      const result = await client.predict('/generate_video', [
        handle_file(blob),
        prompt,
        6,
        '',
        duration,
        1,
        1,
        42,
        true
      ]);

      const output = result?.data?.[0];

      let videoUrl =
        typeof output === 'string'
          ? output
          : output?.url ||
            output?.video?.url ||
            null;

      if (videoUrl && !/^https?:\/\//i.test(videoUrl)) {
        if (videoUrl.startsWith('/gradio_api/')) {
          videoUrl = new URL(videoUrl, SPACE).href;
        } else {
          throw new Error(
            'Wan 2.2 returned a local file path instead of a public video URL.'
          );
        }
      }

      if (!videoUrl) {
        throw new Error(
          'Wan 2.2 finished without returning a valid video URL.'
        );
      }

      task.status = 'completed';
      task.progress = 100;
      task.url = videoUrl;

      console.log('Wan 2.2 video completed:', id);
    } catch (error) {
      task.status = 'failed';
      task.progress = 0;
      task.error = String(
        error?.message || error
      ).slice(0, 500);

      console.error('Wan 2.2 generation failed:', task.error);
    }
  })();

  return {
    video_id: id,
    provider: 'Wan 2.2',
    status: 'pending'
  };
}

module.exports = { startWan22 };

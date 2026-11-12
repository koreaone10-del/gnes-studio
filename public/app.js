document.addEventListener('DOMContentLoaded', () => {
  const $ = id => document.getElementById(id);
  const toast = $('toast');
  let toastTimer;
  function notify(message) {
    toast.textContent = message || 'حدث خطأ غير متوقع.';
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 6500);
  }
  function activateTab(name) {
    const image = name === 'image';
    $('panel-image').classList.toggle('hidden', !image);
    $('panel-video').classList.toggle('hidden', image);
    $('tab-image').classList.toggle('active', image);
    $('tab-video').classList.toggle('active', !image);
  }
  $('tab-image').addEventListener('click', () => activateTab('image'));
  $('tab-video').addEventListener('click', () => activateTab('video'));

  function showFiles(input, target) {
    const files = [...input.files];
    target.textContent = files.length
      ? files.map(f => `${f.name} · ${(f.size / 1024 / 1024).toFixed(1)}MB`).join('  |  ')
      : '';
  }
  $('image-references').addEventListener('change', e => showFiles(e.target, $('image-files')));
  $('video-references').addEventListener('change', e => showFiles(e.target, $('video-files')));
  $('video-mode').addEventListener('change', () => {
    const required = $('video-mode').value === 'keyframe';
    $('video-image-required').textContent = required ? 'REQUIRED' : 'OPTIONAL';
    $('video-references').required = required;
  });

  async function readResponse(response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `فشل الطلب (${response.status})`);
    return data;
  }

  $('btn-generate-image').addEventListener('click', async () => {
    const prompt = $('image-prompt').value.trim();
    if (!prompt) return notify('اكتب وصف الصورة أولاً.');
    const button = $('btn-generate-image');
    button.disabled = true;
    button.innerHTML = '<span>◌</span> جاري توليد الصورة...';
    $('image-empty').classList.remove('hidden');
    $('image-empty').querySelector('b').textContent = 'يتم الآن إنشاء الصورة';
    $('generated-image').classList.add('hidden');
    $('download-image').classList.add('hidden');

    const form = new FormData();
    form.append('prompt', prompt);
    form.append('size', $('image-size').value);
    form.append('ratio', $('image-ratio').value);
    [...$('image-references').files].forEach(file => form.append('referenceImages', file));

    try {
      const data = await readResponse(await fetch('/api/generate-image', { method: 'POST', body: form }));
      $('generated-image').src = data.url;
      $('generated-image').classList.remove('hidden');
      $('image-empty').classList.add('hidden');
      $('download-image').href = data.url;
      $('download-image').classList.remove('hidden');
    } catch (error) {
      $('image-empty').querySelector('b').textContent = 'لم يكتمل التوليد';
      notify(error.message);
    } finally {
      button.disabled = false;
      button.innerHTML = '<span>✦</span> توليد الصورة <b>↗</b>';
    }
  });

  let pollTimer = null;
  $('btn-generate-video').addEventListener('click', async () => {
    const prompt = $('video-prompt').value.trim();
    const mode = $('video-mode').value;
    const files = [...$('video-references').files];
    if (!prompt) return notify('اكتب وصف الفيديو أولاً.');
    if (mode === 'keyframe' && !files.length) return notify('ارفع صورة البداية في وضع صورة إلى فيديو.');

    clearInterval(pollTimer);
    const button = $('btn-generate-video');
    button.disabled = true;
    button.innerHTML = '<span>◌</span> جاري إرسال الطلب...';
    $('video-empty').classList.add('hidden');
    $('generated-video').classList.add('hidden');
    $('download-video').classList.add('hidden');
    $('video-progress').classList.remove('hidden');
    $('video-status-text').textContent = 'يتم إرسال مشروعك إلى مزود الفيديو...';
    $('video-progress-bar').style.width = '4%';

    const form = new FormData();
    form.append('prompt', prompt);
    form.append('mode', mode);
    form.append('seconds', $('video-seconds').value);
    form.append('ratio', $('video-ratio').value);
    files.forEach(file => form.append('referenceImages', file));

    try {
      const started = await readResponse(await fetch('/api/generate-video', { method: 'POST', body: form }));
      $('video-status-text').textContent = `تم قبول الطلب بواسطة ${started.provider}. جاري المعالجة...`;
      let attempts = 0;
      const poll = async () => {
        attempts++;
        try {
          const status = await readResponse(await fetch(`/api/video-status?video_id=${encodeURIComponent(started.video_id)}`));
          const progress = Math.max(3, Math.min(100, Number(status.progress) || Math.min(92, attempts * 4)));
          $('video-progress-bar').style.width = `${progress}%`;
          $('video-status-text').textContent = status.status === 'completed'
            ? 'اكتمل الفيديو بنجاح.'
            : `المزود: ${started.provider} · ${status.status || 'processing'}`;
          if (status.status === 'completed' && status.url) {
            clearInterval(pollTimer);
            $('video-progress').classList.add('hidden');
            $('generated-video').src = status.url;
            $('generated-video').classList.remove('hidden');
            $('download-video').href = status.url;
            $('download-video').classList.remove('hidden');
            $('generated-video').load();
            button.disabled = false;
            button.innerHTML = '<span>▶</span> إنشاء الفيديو <b>↗</b>';
            return;
          }
          if (status.status === 'failed') throw new Error(status.error || 'أخفق مزود الفيديو في إنشاء النتيجة.');
          if (attempts >= 120) throw new Error('استغرق التوليد وقتاً أطول من المتوقع. تحقق لاحقاً من حالة الخدمة.');
        } catch (error) {
          clearInterval(pollTimer);
          $('video-progress').classList.add('hidden');
          $('video-empty').classList.remove('hidden');
          notify(error.message);
          button.disabled = false;
          button.innerHTML = '<span>▶</span> إنشاء الفيديو <b>↗</b>';
        }
      };
      await poll();
      if (attempts < 120 && !$('video-progress').classList.contains('hidden')) {
        pollTimer = setInterval(poll, 5000);
      }
    } catch (error) {
      $('video-progress').classList.add('hidden');
      $('video-empty').classList.remove('hidden');
      notify(error.message);
      button.disabled = false;
      button.innerHTML = '<span>▶</span> إنشاء الفيديو <b>↗</b>';
    }
  });
});
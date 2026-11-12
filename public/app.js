document.addEventListener('DOMContentLoaded', () => {
    // التبديل بين التبويبات
    const tabImage = document.getElementById('tab-image');
    const tabVideo = document.getElementById('tab-video');
    const panelImage = document.getElementById('panel-image');
    const panelVideo = document.getElementById('panel-video');

    function activateTab(tab) {
        if (tab === 'image') {
            panelImage.classList.remove('hidden');
            panelVideo.classList.add('hidden');
            tabImage.classList.add('bg-blue-600', 'text-white');
            tabImage.classList.remove('bg-gray-700', 'text-gray-300');
            tabVideo.classList.remove('bg-purple-600', 'text-white');
            tabVideo.classList.add('bg-gray-700', 'text-gray-300');
        } else {
            panelVideo.classList.remove('hidden');
            panelImage.classList.add('hidden');
            tabVideo.classList.add('bg-purple-600', 'text-white');
            tabVideo.classList.remove('bg-gray-700', 'text-gray-300');
            tabImage.classList.remove('bg-blue-600', 'text-white');
            tabImage.classList.add('bg-gray-700', 'text-gray-300');
        }
    }

    tabImage.addEventListener('click', () => activateTab('image'));
    tabVideo.addEventListener('click', () => activateTab('video'));

    // ---------- توليد الصور ----------
    const btnGenImage = document.getElementById('btn-generate-image');
    const imagePrompt = document.getElementById('image-prompt');
    const imageSize = document.getElementById('image-size');
    const imageRatio = document.getElementById('image-ratio');
    const imageRefs = document.getElementById('image-references');
    const imageResult = document.getElementById('image-result');
    const generatedImage = document.getElementById('generated-image');
    const downloadImage = document.getElementById('download-image');

    btnGenImage.addEventListener('click', async () => {
        const prompt = imagePrompt.value.trim();
        if (!prompt) return alert('يرجى إدخال وصف للصورة.');

        btnGenImage.disabled = true;
        btnGenImage.textContent = 'جاري التوليد...';
        imageResult.classList.add('hidden');

        const formData = new FormData();
        formData.append('prompt', prompt);
        formData.append('size', imageSize.value);
        formData.append('ratio', imageRatio.value);
        for (const file of imageRefs.files) {
            formData.append('referenceImages', file);
        }

        try {
            const response = await fetch('/api/generate-image', { method: 'POST', body: formData });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'فشل التوليد');

            generatedImage.src = data.url;
            downloadImage.href = data.url;
            downloadImage.download = 'agnes-image.png';
            imageResult.classList.remove('hidden');
        } catch (error) {
            alert('خطأ: ' + error.message);
        } finally {
            btnGenImage.disabled = false;
            btnGenImage.textContent = '✨ توليد الصورة';
        }
    });

    // ---------- توليد الفيديو ----------
    const btnGenVideo = document.getElementById('btn-generate-video');
    const videoPrompt = document.getElementById('video-prompt');
    const videoMode = document.getElementById('video-mode');
    const videoSeconds = document.getElementById('video-seconds');
    const videoRatio = document.getElementById('video-ratio');
    const videoRefs = document.getElementById('video-references');
    const videoResult = document.getElementById('video-result');
    const generatedVideo = document.getElementById('generated-video');
    const downloadVideo = document.getElementById('download-video');
    const videoProgress = document.getElementById('video-progress');
    const videoStatusText = document.getElementById('video-status-text');
    const videoProgressBar = document.getElementById('video-progress-bar');

    let pollingInterval = null;

    btnGenVideo.addEventListener('click', async () => {
        const prompt = videoPrompt.value.trim();
        if (!prompt) return alert('يرجى إدخال وصف للفيديو.');

        // التحقق من الإطارات إذا كان الوضع "صورة إلى فيديو"
        if (videoMode.value === 'keyframe' && videoRefs.files.length === 0) {
            return alert('وضع "صورة إلى فيديو" يتطلب اختيار صورة واحدة على الأقل.');
        }

        if (pollingInterval) clearInterval(pollingInterval);

        btnGenVideo.disabled = true;
        btnGenVideo.textContent = 'جاري الرفع والبدء...';
        videoResult.classList.add('hidden');
        videoProgress.classList.remove('hidden');
        videoProgressBar.style.width = '0%';
        videoStatusText.textContent = 'جاري إرسال الطلب (قد يستغرق رفع الصور ثوانٍ)...';

        const formData = new FormData();
        formData.append('prompt', prompt);
        formData.append('mode', videoMode.value);
        formData.append('seconds', videoSeconds.value);
        formData.append('ratio', videoRatio.value);
        for (const file of videoRefs.files) {
            formData.append('referenceImages', file);
        }

        try {
            const response = await fetch('/api/generate-video', { method: 'POST', body: formData });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'فشل بدء المهمة');

            const videoId = data.video_id;
            videoStatusText.textContent = 'تم بدء المعالجة، جاري التوليد...';

            pollingInterval = setInterval(async () => {
                try {
                    const statusRes = await fetch(`/api/video-status?video_id=${videoId}`);
                    const statusData = await statusRes.json();
                    if (!statusRes.ok) throw new Error(statusData.error);

                    videoProgressBar.style.width = (statusData.progress || 0) + '%';
                    videoStatusText.textContent = `الحالة: ${statusData.status} (${statusData.progress || 0}%)`;

                    if (statusData.status === 'completed' && statusData.url) {
                        clearInterval(pollingInterval);
                        videoProgress.classList.add('hidden');
                        videoResult.classList.remove('hidden');
                        generatedVideo.src = statusData.url;
                        downloadVideo.href = statusData.url;
                        downloadVideo.download = 'agnes-video.mp4';
                    } else if (statusData.status === 'failed') {
                        clearInterval(pollingInterval);
                        throw new Error('فشلت عملية التوليد.');
                    }
                } catch (pollError) {
                    clearInterval(pollingInterval);
                    alert('خطأ في متابعة الحالة: ' + pollError.message);
                    videoProgress.classList.add('hidden');
                }
            }, 3000); // التحقق كل 3 ثوانٍ

        } catch (error) {
            alert('خطأ: ' + error.message);
            videoProgress.classList.add('hidden');
        } finally {
            btnGenVideo.disabled = false;
            btnGenVideo.textContent = '🎬 توليد الفيديو';
        }
    });
});

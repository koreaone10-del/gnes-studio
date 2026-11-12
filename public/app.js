document.addEventListener('DOMContentLoaded', () => {
    const tabImage = document.getElementById('tab-image'), tabVideo = document.getElementById('tab-video');
    const panelImage = document.getElementById('panel-image'), panelVideo = document.getElementById('panel-video');
    function activateTab(tab) {
        if (tab === 'image') {
            panelImage.classList.remove('hidden'); panelVideo.classList.add('hidden');
            tabImage.className = 'tab-btn px-6 py-3 rounded-full font-bold bg-blue-600 text-white shadow-lg transition';
            tabVideo.className = 'tab-btn px-6 py-3 rounded-full font-bold bg-gray-700 text-gray-300 hover:bg-gray-600 transition';
        } else {
            panelVideo.classList.remove('hidden'); panelImage.classList.add('hidden');
            tabVideo.className = 'tab-btn px-6 py-3 rounded-full font-bold bg-purple-600 text-white shadow-lg transition';
            tabImage.className = 'tab-btn px-6 py-3 rounded-full font-bold bg-gray-700 text-gray-300 hover:bg-gray-600 transition';
        }
    }
    tabImage.addEventListener('click', () => activateTab('image')); tabVideo.addEventListener('click', () => activateTab('video'));

    // Image logic (كما هو)
    const btnGenImage = document.getElementById('btn-generate-image'), imagePrompt = document.getElementById('image-prompt');
    const imageSize = document.getElementById('image-size'), imageRatio = document.getElementById('image-ratio'), imageRefs = document.getElementById('image-references');
    const imageResult = document.getElementById('image-result'), generatedImage = document.getElementById('generated-image'), downloadImage = document.getElementById('download-image');
    btnGenImage.addEventListener('click', async () => {
        if (!imagePrompt.value.trim()) return alert('يرجى إدخال وصف للصورة.');
        btnGenImage.disabled = true; btnGenImage.textContent = 'جاري التوليد...'; imageResult.classList.add('hidden');
        const formData = new FormData();
        formData.append('prompt', imagePrompt.value.trim()); formData.append('size', imageSize.value); formData.append('ratio', imageRatio.value);
        for (const file of imageRefs.files) formData.append('referenceImages', file);
        try {
            const res = await fetch('/api/generate-image', { method: 'POST', body: formData });
            const data = await res.json(); if (!res.ok) throw new Error(data.error);
            generatedImage.src = data.url; downloadImage.href = data.url; imageResult.classList.remove('hidden');
        } catch (e) { alert('خطأ: ' + e.message); } finally { btnGenImage.disabled = false; btnGenImage.textContent = '✨ توليد الصورة'; }
    });

    // Video logic (محدث لدعم المدد الطويلة والمزودين)
    const btnGenVideo = document.getElementById('btn-generate-video'), videoPrompt = document.getElementById('video-prompt');
    const videoMode = document.getElementById('video-mode'), videoSeconds = document.getElementById('video-seconds'), videoRatio = document.getElementById('video-ratio');
    const videoRefs = document.getElementById('video-references'), videoResult = document.getElementById('video-result'), generatedVideo = document.getElementById('generated-video');
    const downloadVideo = document.getElementById('download-video'), videoProgress = document.getElementById('video-progress');
    const videoStatusText = document.getElementById('video-status-text'), videoProgressBar = document.getElementById('video-progress-bar');
    let pollingInterval = null;

    btnGenVideo.addEventListener('click', async () => {
        if (!videoPrompt.value.trim()) return alert('يرجى إدخال وصف للفيديو.');
        if (videoMode.value === 'keyframe' && videoRefs.files.length === 0) return alert('وضع "صورة إلى فيديو" يتطلب صورة.');

        if (pollingInterval) clearInterval(pollingInterval);
        btnGenVideo.disabled = true; btnGenVideo.textContent = 'جاري بدء المهمة...';
        videoResult.classList.add('hidden'); videoProgress.classList.remove('hidden'); videoProgressBar.style.width = '0%';
        videoStatusText.textContent = 'جاري إرسال الطلب (قد يستغرق الأمر بعض الوقت)...';

        const formData = new FormData();
        formData.append('prompt', videoPrompt.value.trim()); formData.append('mode', videoMode.value);
        formData.append('seconds', videoSeconds.value); formData.append('ratio', videoRatio.value);
        for (const file of videoRefs.files) formData.append('referenceImages', file);

        try {
            const res = await fetch('/api/generate-video', { method: 'POST', body: formData });
            const data = await res.json(); if (!res.ok) throw new Error(data.error);
            
            const videoId = data.video_id;
            videoStatusText.textContent = `المزود: ${data.provider} | جاري المعالجة...`;

            pollingInterval = setInterval(async () => {
                try {
                    const statusRes = await fetch(`/api/video-status?video_id=${videoId}`);
                    const statusData = await statusRes.json(); if (!statusRes.ok) throw new Error(statusData.error);
                    videoProgressBar.style.width = (statusData.progress || 0) + '%';
                    videoStatusText.textContent = `الحالة: ${statusData.status} (${statusData.progress || 0}%)`;

                    if (statusData.status === 'completed' && statusData.url) {
                        clearInterval(pollingInterval); videoProgress.classList.add('hidden'); videoResult.classList.remove('hidden');
                        generatedVideo.src = statusData.url; downloadVideo.href = statusData.url;
                    } else if (statusData.status === 'failed') {
                        clearInterval(pollingInterval); throw new Error('فشلت عملية التوليد.');
                    }
                } catch (e) { clearInterval(pollingInterval); alert('خطأ: ' + e.message); videoProgress.classList.add('hidden'); }
            }, 3000);
        } catch (e) {
            alert('خطأ: ' + e.message); videoProgress.classList.add('hidden');
        } finally { btnGenVideo.disabled = false; btnGenVideo.textContent = '🎬 توليد الفيديو'; }
    });
});

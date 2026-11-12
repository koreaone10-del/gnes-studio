require('dotenv').config();
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const AGNES_API_KEY = process.env.AGNES_API_KEY;
const AGNES_BASE_URL = 'https://apihub.agnes-ai.com/v1';

if (!AGNES_API_KEY) {
  console.error('خطأ: مفتاح AGNES_API_KEY غير موجود.');
  process.exit(1);
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const agnesClient = axios.create({
  baseURL: AGNES_BASE_URL,
  headers: {
    'Authorization': `Bearer ${AGNES_API_KEY}`,
    'Content-Type': 'application/json',
  },
});

// ---------- توليد الصور ----------
app.post('/api/generate-image', upload.array('referenceImages', 5), async (req, res) => {
  try {
    const { prompt, size, ratio } = req.body;
    if (!prompt) return res.status(400).json({ error: 'البرومبت مطلوب.' });

    const payload = {
      model: 'agnes-image-2.5-flash',
      prompt: prompt,
      size: size || '2K',
      ratio: ratio || '16:9',
      extra_body: { response_format: 'url' },
    };

    if (req.files && req.files.length > 0) {
      payload.extra_body.image = req.files.map(file => 
        `data:${file.mimetype};base64,${file.buffer.toString('base64')}`
      );
    }

    const response = await agnesClient.post('/images/generations', payload);
    res.json({ url: response.data.data[0].url });
  } catch (error) {
    console.error('خطأ في توليد الصورة:', error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data?.message || 'فشل توليد الصورة.' });
  }
});

// ---------- توليد الفيديو (بناء طلب ديناميكي) ----------
app.post('/api/generate-video', upload.array('referenceImages', 5), async (req, res) => {
  try {
    const { prompt, mode, seconds, ratio } = req.body;
    if (!prompt) return res.status(400).json({ error: 'البرومبت مطلوب.' });

    // 1. بناء الحمولة الأساسية (بدون أي حقول صور مطلقاً)
    const payload = {
      model: 'agnes-video-2.5-flash',
      prompt: prompt,
      mode: mode || 'text',
      seconds: String(seconds || '4'),
      size: '720P',
      aspect_ratio: ratio || '16:9',
      n: 1,
    };

    // 2. إضافة حقول الصور فقط إذا كان النمط يتطلب ذلك
    if (mode === 'keyframe') {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'وضع "صورة إلى فيديو" يتطلب رفع صورة واحدة على الأقل.' });
      }
      payload.first_frame = `data:${req.files[0].mimetype};base64,${req.files[0].buffer.toString('base64')}`;
      
      if (req.files.length > 1) {
        payload.last_frame = `data:${req.files[1].mimetype};base64,${req.files[1].buffer.toString('base64')}`;
      }
    } else if (mode === 'reference') {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'وضع "المراجع البصرية" يتطلب رفع صورة واحدة على الأقل.' });
      }
      payload.images = req.files.map(file => 
        `data:${file.mimetype};base64,${file.buffer.toString('base64')}`
      );
    }
    // في وضع "text"، لا نضيف أي شيء. الحمولة تبقى نظيفة تماماً.

    const createResponse = await agnesClient.post('/videos', payload);
    const videoId = createResponse.data.video_id || createResponse.data.id || createResponse.data.task_id;
    
    if (!videoId) {
      console.error('استجابة غير متوقعة:', createResponse.data);
      throw new Error('لم يتم إرجاع معرف الفيديو.');
    }

    res.json({ video_id: videoId, status: 'pending' });
  } catch (error) {
    console.error('خطأ في إنشاء مهمة الفيديو:', error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data?.message || error.message || 'فشل بدء توليد الفيديو.' });
  }
});

// ---------- التحقق من حالة الفيديو ----------
app.get('/api/video-status', async (req, res) => {
  try {
    const { video_id } = req.query;
    if (!video_id) return res.status(400).json({ error: 'معرف الفيديو مطلوب.' });

    const pollUrl = `https://apihub.agnes-ai.com/agnesapi?video_id=${video_id}&model_name=agnes-video-2.5-flash`;
    
    const response = await axios.get(pollUrl, {
      headers: { 'Authorization': `Bearer ${AGNES_API_KEY}` },
    });

    const data = response.data;
    res.json({
      status: data.status,
      url: data.url || (data.metadata && data.metadata.url) || null,
      progress: data.progress || 0,
    });
  } catch (error) {
    console.error('خطأ في التحقق من الحالة:', error.response?.data || error.message);
    res.status(500).json({ error: 'فشل التحقق من الحالة.' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`الخادم يعمل على المنفذ ${PORT}`);
});

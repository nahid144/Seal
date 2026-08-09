import { Router } from 'express';

const router = Router();

const isValidUrl = (string) => {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
};

router.post('/info', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }
    if (!isValidUrl(url)) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    const downloadManager = req.app.get('downloadManager');
    const info = await downloadManager.getVideoInfo(url);
    res.json(info);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/start', async (req, res) => {
  try {
    const { url, formatId, mode } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }
    if (!isValidUrl(url)) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }
    if (mode && !['video', 'audio'].includes(mode)) {
      return res.status(400).json({ error: 'Mode must be "video" or "audio"' });
    }

    const downloadManager = req.app.get('downloadManager');
    const downloadInfo = await downloadManager.startDownload(url, formatId, mode || 'video');
    res.json({ id: downloadInfo.id, status: downloadInfo.status });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/cancel/:id', (req, res) => {
  const downloadManager = req.app.get('downloadManager');
  const success = downloadManager.cancelDownload(req.params.id);
  
  if (success) {
    res.json({ status: 'cancelled' });
  } else {
    res.status(404).json({ error: 'Download not found or already completed' });
  }
});

router.get('/active', (req, res) => {
  const downloadManager = req.app.get('downloadManager');
  res.json(downloadManager.getActiveDownloads());
});

router.get('/history', (req, res) => {
  const downloadManager = req.app.get('downloadManager');
  res.json(downloadManager.getHistory());
});

router.delete('/file/:filename', (req, res) => {
  const downloadManager = req.app.get('downloadManager');
  const success = downloadManager.deleteFile(req.params.filename);
  
  if (success) {
    res.json({ status: 'deleted' });
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

router.get('/file/:filename', (req, res) => {
  const downloadManager = req.app.get('downloadManager');
  const filePath = downloadManager.getFilePath(req.params.filename);
  
  if (!filePath) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  const filename = filePath.split('/').pop();
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.sendFile(filePath);
});

export default router;

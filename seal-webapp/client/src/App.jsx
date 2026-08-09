import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const API_BASE = '/api';
const SOCKET_URL = window.location.origin;

function App() {
  const [url, setUrl] = useState('');
  const [videoInfo, setVideoInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [downloads, setDownloads] = useState([]);
  const [history, setHistory] = useState([]);
  const [selectedFormat, setSelectedFormat] = useState(null);
  const [downloadMode, setDownloadMode] = useState('video');
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    const newSocket = io(SOCKET_URL, {
      transports: ['websocket', 'polling']
    });
    setSocket(newSocket);

    newSocket.on('download:progress', (data) => {
      setDownloads(prev => prev.map(d => 
        d.id === data.id ? { ...d, progress: data.progress, status: 'downloading' } : d
      ));
    });

    newSocket.on('download:complete', (data) => {
      setDownloads(prev => prev.map(d => 
        d.id === data.id ? { ...d, status: 'completed', progress: 100, filename: data.filename } : d
      ));
      fetchHistory();
    });

    newSocket.on('download:error', (data) => {
      setDownloads(prev => prev.map(d => 
        d.id === data.id ? { ...d, status: 'error', error: data.error } : d
      ));
    });

    newSocket.on('download:info', (data) => {
      setDownloads(prev => prev.map(d => 
        d.id === data.id ? { ...d, filename: data.filename } : d
      ));
    });

    return () => newSocket.close();
  }, []);

  const fetchHistory = async () => {
    try {
      const res = await fetch(`${API_BASE}/download/history`);
      const data = await res.json();
      setHistory(data);
    } catch (err) {
      console.error('Failed to fetch history:', err);
    }
  };

  const handleFetchInfo = async () => {
    if (!url.trim()) {
      setError('Please enter a URL');
      return;
    }

    setLoading(true);
    setError(null);
    setVideoInfo(null);

    try {
      const res = await fetch(`${API_BASE}/download/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to fetch video info');
      }

      const data = await res.json();
      setVideoInfo(data);
      if (data.formats.video.length > 0) {
        setSelectedFormat(data.formats.video[0].formatId);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!videoInfo) return;

    setLoading(true);
    try {
      const formatId = downloadMode === 'audio' ? null : selectedFormat;
      const res = await fetch(`${API_BASE}/download/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: videoInfo.webpage_url, formatId, mode: downloadMode })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to start download');
      }

      const data = await res.json();
      setDownloads(prev => [...prev, {
        id: data.id,
        title: videoInfo.title,
        thumbnail: videoInfo.thumbnail,
        status: 'starting',
        progress: 0,
        mode: downloadMode
      }]);
      
      setUrl('');
      setVideoInfo(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (downloadId) => {
    try {
      await fetch(`${API_BASE}/download/cancel/${downloadId}`, { method: 'POST' });
      setDownloads(prev => prev.filter(d => d.id !== downloadId));
    } catch (err) {
      console.error('Failed to cancel:', err);
    }
  };

  const handleDelete = async (filename) => {
    try {
      await fetch(`${API_BASE}/download/file/${filename}`, { method: 'DELETE' });
      fetchHistory();
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  };

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatSize = (bytes) => {
    if (!bytes) return 'Unknown size';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Seal</h1>
        <p>Web Video Downloader</p>
      </header>

      <main className="main">
        <section className="input-section">
          <div className="url-input-wrapper">
            <input
              type="text"
              className="url-input"
              placeholder="Paste video URL here..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleFetchInfo()}
            />
            <button 
              className="fetch-btn"
              onClick={handleFetchInfo}
              disabled={loading || !url.trim()}
            >
              {loading ? 'Loading...' : 'Fetch'}
            </button>
          </div>
          {error && <div className="error-message">{error}</div>}
        </section>

        {videoInfo && (
          <section className="video-info">
            <div className="video-preview">
              {videoInfo.thumbnail && (
                <img src={videoInfo.thumbnail} alt={videoInfo.title} className="thumbnail" />
              )}
              <div className="video-details">
                <h2>{videoInfo.title}</h2>
                <p>Duration: {formatDuration(videoInfo.duration)}</p>
              </div>
            </div>

            <div className="format-selection">
              <div className="mode-tabs">
                <button 
                  className={`mode-tab ${downloadMode === 'video' ? 'active' : ''}`}
                  onClick={() => setDownloadMode('video')}
                >
                  Video
                </button>
                <button 
                  className={`mode-tab ${downloadMode === 'audio' ? 'active' : ''}`}
                  onClick={() => setDownloadMode('audio')}
                >
                  Audio (MP3)
                </button>
              </div>

              {downloadMode === 'video' ? (
                <div className="formats">
                  <h3>Quality</h3>
                  <div className="format-options">
                    {videoInfo.formats.video.map((format) => (
                      <button
                        key={format.formatId}
                        className={`format-btn ${selectedFormat === format.formatId ? 'selected' : ''}`}
                        onClick={() => setSelectedFormat(format.formatId)}
                      >
                        {format.resolution}
                        {format.filesize && <span className="size">{formatSize(format.filesize)}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="formats">
                  <p className="audio-info">Audio will be downloaded as MP3</p>
                </div>
              )}

              <button 
                className="download-btn"
                onClick={handleDownload}
                disabled={loading || (downloadMode === 'video' && !selectedFormat)}
              >
                {loading ? 'Starting...' : 'Download'}
              </button>
            </div>
          </section>
        )}

        {downloads.length > 0 && (
          <section className="active-downloads">
            <h2>Active Downloads</h2>
            <div className="downloads-list">
              {downloads.map((download) => (
                <div key={download.id} className={`download-item ${download.status}`}>
                  <div className="download-info">
                    <span className="download-title">{download.title || 'Downloading...'}</span>
                    <span className="download-mode">{download.mode}</span>
                  </div>
                  {download.status === 'downloading' && (
                    <div className="progress-bar">
                      <div 
                        className="progress-fill" 
                        style={{ width: `${download.progress}%` }}
                      ></div>
                      <span className="progress-text">{download.progress.toFixed(1)}%</span>
                    </div>
                  )}
                  {download.status === 'completed' && (
                    <div className="download-complete">
                      <a href={`/downloads/${download.filename}`} download className="save-link">
                        Save File
                      </a>
                    </div>
                  )}
                  {download.status === 'error' && (
                    <div className="download-error">{download.error}</div>
                  )}
                  {(download.status !== 'completed' && download.status !== 'error') && (
                    <button 
                      className="cancel-btn"
                      onClick={() => handleCancel(download.id)}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {history.length > 0 && (
          <section className="history">
            <h2>Download History</h2>
            <div className="history-list">
              {history.map((item) => (
                <div key={item.id} className="history-item">
                  <div className="history-info">
                    <span className="history-filename">{item.filename || 'Unknown'}</span>
                    <span className="history-mode">{item.mode}</span>
                    <span className="history-status">{item.status}</span>
                  </div>
                  <div className="history-actions">
                    {item.status === 'completed' && item.filename && (
                      <a href={`/downloads/${item.filename}`} download className="save-link">
                        Save
                      </a>
                    )}
                    <button 
                      className="delete-btn"
                      onClick={() => handleDelete(item.filename)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="footer">
        <p>Powered by yt-dlp | Seal Web Video Downloader</p>
      </footer>
    </div>
  );
}

export default App;

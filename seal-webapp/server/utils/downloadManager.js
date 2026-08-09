import { spawn } from 'child_process';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, extname, resolve } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DOWNLOADS_DIR = join(__dirname, '..', '..', 'downloads');
const YT_DLP_PATH = process.env.YT_DLP_PATH || 'yt-dlp';

let ytDlpAvailable = false;
try {
  execSync(`${YT_DLP_PATH} --version`, { stdio: 'ignore' });
  ytDlpAvailable = true;
} catch (e) {
  console.warn('Warning: yt-dlp not found. Downloads will not work.');
}

if (!existsSync(DOWNLOADS_DIR)) {
  mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

export class DownloadManager {
  constructor(io) {
    this.io = io;
    this.activeDownloads = new Map();
    this.downloadHistory = [];
  }

  async getVideoInfo(url) {
    if (!ytDlpAvailable) {
      throw new Error('yt-dlp is not installed. Please install yt-dlp to use this feature.');
    }
    
    return new Promise((resolve, reject) => {
      const args = [
        '--dump-json',
        '--no-download',
        '--no-warnings',
        url
      ];

      const proc = spawn(YT_DLP_PATH, args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(stderr || 'Failed to fetch video info'));
        } else {
          try {
            const info = JSON.parse(stdout);
            resolve({
              id: info.id,
              title: info.title,
              thumbnail: info.thumbnail,
              duration: info.duration,
              formats: this._extractFormats(info.formats || []),
              webpage_url: info.webpage_url || url
            });
          } catch (e) {
            reject(new Error('Failed to parse video info'));
          }
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`yt-dlp not found: ${err.message}`));
      });
    });
  }

  _extractFormats(formats) {
    const videoFormats = formats
      .filter(f => f.vcodec !== 'none' && f.ext === 'mp4')
      .map(f => ({
        formatId: f.format_id,
        ext: f.ext,
        resolution: f.height ? `${f.height}p` : 'audio only',
        height: f.height || 0,
        filesize: f.filesize,
        vcodec: f.vcodec,
        acodec: f.acodec,
        fps: f.fps
      }))
      .sort((a, b) => (b.height || 0) - (a.height || 0));

    const audioFormats = formats
      .filter(f => f.vcodec === 'none')
      .map(f => ({
        formatId: f.format_id,
        ext: f.ext === 'm4a' ? 'mp3' : f.ext,
        abr: f.abr,
        filesize: f.filesize,
        acodec: f.acodec
      }))
      .sort((a, b) => (b.abr || 0) - (a.abr || 0));

    const uniqueResolutions = new Map();
    videoFormats.forEach(f => {
      if (!uniqueResolutions.has(f.resolution) || f.height > uniqueResolutions.get(f.resolution).height) {
        uniqueResolutions.set(f.resolution, f);
      }
    });

    return {
      video: Array.from(uniqueResolutions.values()),
      audio: audioFormats.slice(0, 5)
    };
  }

  async startDownload(url, formatId, mode = 'video') {
    if (!ytDlpAvailable) {
      throw new Error('yt-dlp is not installed. Please install yt-dlp to use this feature.');
    }
    
    const downloadId = uuidv4();
    const outputTemplate = join(DOWNLOADS_DIR, `${downloadId}_%(title)s.%(ext)s`);

    let args = [
      '--no-warnings',
      '--newline',
      '-o', outputTemplate
    ];

    if (mode === 'audio') {
      args.push('-x', '--audio-format', 'mp3');
      if (formatId) args.push('--audio-quality', formatId);
    } else {
      if (formatId) args.push('-f', formatId);
      else args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best');
      args.push('--merge-output-format', 'mp4');
    }

    args.push(url);

    const downloadInfo = {
      id: downloadId,
      url,
      mode,
      formatId,
      status: 'starting',
      progress: 0,
      filename: null,
      startTime: Date.now()
    };

    this.activeDownloads.set(downloadId, downloadInfo);
    this.io.emit('download:start', downloadInfo);

    return new Promise((resolve, reject) => {
      const proc = spawn(YT_DLP_PATH, args);
      let stderr = '';

      proc.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        lines.forEach(line => {
          const progressMatch = line.match(/\[download\]\s+([0-9.]+)%/);
          if (progressMatch) {
            const progress = parseFloat(progressMatch[1]);
            downloadInfo.progress = progress;
            downloadInfo.status = 'downloading';
            this.io.emit('download:progress', { id: downloadId, progress });
          }

          const destinationMatch = line.match(/\[download\]\s+Destination:\s+(.+)/);
          if (destinationMatch) {
            downloadInfo.filename = destinationMatch[1].split('/').pop();
            downloadInfo.status = 'downloading';
            this.io.emit('download:info', { id: downloadId, filename: downloadInfo.filename });
          }

          const mergeMatch = line.match(/\[Merger\]\s+Merging formats into "(.+)"/);
          if (mergeMatch) {
            downloadInfo.filename = mergeMatch[1].split('/').pop();
          }
        });
      });

      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code !== 0) {
          downloadInfo.status = 'error';
          downloadInfo.error = stderr || 'Download failed';
          this.io.emit('download:error', { id: downloadId, error: downloadInfo.error });
          this.downloadHistory.push({ ...downloadInfo });
          reject(new Error(downloadInfo.error));
        } else {
          downloadInfo.status = 'completed';
          downloadInfo.progress = 100;
          downloadInfo.endTime = Date.now();
          downloadInfo.duration = downloadInfo.endTime - downloadInfo.startTime;
          
          const files = readdirSync(DOWNLOADS_DIR);
          const matchingFile = files.find(f => f.startsWith(downloadId));
          if (matchingFile) {
            downloadInfo.filename = matchingFile;
          }
          
          this.io.emit('download:complete', { 
            id: downloadId, 
            filename: downloadInfo.filename,
            duration: downloadInfo.duration 
          });
          this.downloadHistory.push({ ...downloadInfo });
          this.activeDownloads.delete(downloadId);
          resolve(downloadInfo);
        }
      });

      proc.on('error', (err) => {
        downloadInfo.status = 'error';
        downloadInfo.error = err.message;
        this.io.emit('download:error', { id: downloadId, error: err.message });
        reject(err);
      });

      downloadInfo.process = proc;
    });
  }

  cancelDownload(downloadId) {
    const download = this.activeDownloads.get(downloadId);
    if (download && download.process) {
      download.process.kill('SIGTERM');
      download.status = 'cancelled';
      this.io.emit('download:cancelled', { id: downloadId });
      this.activeDownloads.delete(downloadId);
      return true;
    }
    return false;
  }

  getActiveDownloads() {
    return Array.from(this.activeDownloads.values()).map(d => ({
      id: d.id,
      url: d.url,
      mode: d.mode,
      status: d.status,
      progress: d.progress,
      filename: d.filename
    }));
  }

  getHistory() {
    return this.downloadHistory.map(d => ({
      id: d.id,
      url: d.url,
      mode: d.mode,
      status: d.status,
      filename: d.filename,
      duration: d.duration,
      startTime: d.startTime,
      endTime: d.endTime
    }));
  }

  deleteFile(filename) {
    const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, '');
    if (sanitized !== filename || sanitized.includes('..')) {
      return false;
    }
    
    const filePath = join(DOWNLOADS_DIR, sanitized);
    const resolvedPath = resolve(filePath);
    const downloadsDirResolved = resolve(DOWNLOADS_DIR);
    
    if (!resolvedPath.startsWith(downloadsDirResolved)) {
      return false;
    }
    
    if (existsSync(resolvedPath)) {
      unlinkSync(resolvedPath);
      return true;
    }
    return false;
  }

  getFilePath(filename) {
    const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, '');
    if (sanitized !== filename || sanitized.includes('..')) {
      return null;
    }
    
    const filePath = join(DOWNLOADS_DIR, sanitized);
    const resolvedPath = resolve(filePath);
    const downloadsDirResolved = resolve(DOWNLOADS_DIR);
    
    if (!resolvedPath.startsWith(downloadsDirResolved)) {
      return null;
    }
    
    if (existsSync(resolvedPath)) {
      return resolvedPath;
    }
    return null;
  }
}

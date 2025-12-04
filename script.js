document.addEventListener('DOMContentLoaded', () => {
    const videoUrlInput = document.getElementById('videoUrl');
    const playBtn = document.getElementById('playBtn');
    const mainVideo = document.getElementById('mainVideo');
    const videoWrapper = document.getElementById('videoWrapper');

    let activePlayer = null;

    const cleanup = () => {
        if (activePlayer) {
            if (activePlayer.destroy) activePlayer.destroy();
            if (activePlayer.detachMedia) activePlayer.detachMedia();
            activePlayer = null;
        }
        mainVideo.removeAttribute('src');
        mainVideo.load();
    };

    const tryMpegts = (url) => {
        return new Promise((resolve, reject) => {
            if (!mpegts.getFeatureList().mseLivePlayback) {
                return reject('MPEGTS not supported');
            }

            const player = mpegts.createPlayer({
                type: 'mse',
                isLive: true,
                url: url,
                cors: true
            }, {
                enableWorker: true,
                lazyLoadMaxDuration: 3 * 60,
                seekType: 'range',
                liveBufferLatencyChasing: true, // Auto-catchup for live streams
                liveBufferLatencyMaxLatency: 15, // Max latency before jump
                liveBufferLatencyMinRemain: 0.3
            });

            player.attachMediaElement(mainVideo);
            player.load();

            player.on(mpegts.Events.ERROR, (type, details, data) => {
                player.destroy();
                reject(details);
            });

            mainVideo.onplaying = () => {
                activePlayer = player;
                resolve();
            };

            setTimeout(() => {
                if (!activePlayer) {
                    player.destroy();
                    reject('MPEGTS Timeout');
                }
            }, 10000);

            player.play().catch(() => { });
        });
    };

    const tryHls = (url) => {
        return new Promise((resolve, reject) => {
            if (!Hls.isSupported()) return reject('HLS not supported');

            const hls = new Hls({
                enableWorker: true,
                lowLatencyMode: true,
            });
            hls.loadSource(url);
            hls.attachMedia(mainVideo);

            hls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    hls.destroy();
                    reject(`HLS Fatal Error`);
                }
            });

            mainVideo.onplaying = () => {
                activePlayer = hls;
                resolve();
            };

            setTimeout(() => {
                if (!activePlayer) {
                    hls.destroy();
                    reject('HLS Timeout');
                }
            }, 10000);
        });
    };

    const tryNative = (url) => {
        return new Promise((resolve, reject) => {
            mainVideo.src = url;

            const onPlaying = () => {
                cleanupListeners();
                resolve();
            };

            const onError = (e) => {
                cleanupListeners();
                const error = mainVideo.error;
                reject(`Native Error: ${error ? error.message || error.code : 'Unknown'}`);
            };

            const cleanupListeners = () => {
                mainVideo.removeEventListener('playing', onPlaying);
                mainVideo.removeEventListener('error', onError);
            };

            mainVideo.addEventListener('playing', onPlaying);
            mainVideo.addEventListener('error', onError);

            mainVideo.play().catch(() => {
                // Ignore initial play promise rejection, wait for error event or timeout
            });

            setTimeout(() => {
                if (mainVideo.paused && mainVideo.readyState < 3) {
                    cleanupListeners();
                    reject('Native Timeout');
                }
            }, 5000); // Reduced timeout for faster fallback
        });
    };

    const loadAndPlayVideo = async () => {
        const rawUrl = videoUrlInput.value.trim();
        if (!rawUrl) return;

        cleanup();
        videoWrapper.classList.add('active');

        // Helper to get extension
        const getExtension = (url) => {
            try {
                const path = new URL(url).pathname;
                return path.split('.').pop().toLowerCase();
            } catch {
                return '';
            }
        };

        const ext = getExtension(rawUrl);
        const strategies = [];

        // Smart Strategy Selection based on extension
        if (ext === 'm3u8') {
            // HLS Priority
            strategies.push(() => tryHls(rawUrl));
            strategies.push(() => tryHls(`https://corsproxy.io/?${encodeURIComponent(rawUrl)}`));
        } else if (ext === 'ts' || ext === 'flv') {
            // MPEG-TS/FLV Priority
            strategies.push(() => tryMpegts(rawUrl));
            strategies.push(() => tryNative(rawUrl)); // Fallback to native
        } else if (ext === 'mp4' || ext === 'mkv' || ext === 'webm' || ext === 'mov') {
            // Native Priority (MP4, MKV, etc)
            strategies.push(() => tryNative(rawUrl));
            strategies.push(() => tryNative(`https://corsproxy.io/?${encodeURIComponent(rawUrl)}`));
        } else {
            // Unknown extension: Try Native FIRST (best for MP4/MKV), then Stream formats
            strategies.push(() => tryNative(rawUrl));
            strategies.push(() => tryMpegts(rawUrl));
            strategies.push(() => tryHls(rawUrl));
            strategies.push(() => tryNative(`https://corsproxy.io/?${encodeURIComponent(rawUrl)}`));
            strategies.push(() => tryHls(`https://corsproxy.io/?${encodeURIComponent(rawUrl)}`));
        }

        for (const strategy of strategies) {
            try {
                await strategy();
                console.log('Video loaded successfully');
                return;
            } catch (e) {
                console.warn('Strategy failed, trying next...', e);
                // Continue to next strategy
            }
        }

        alert('Could not play video. Please check the URL or file format.');
    };

    playBtn.addEventListener('click', loadAndPlayVideo);
    videoUrlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loadAndPlayVideo();
    });
});

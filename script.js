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

            mainVideo.onplaying = () => {
                resolve();
            };

            mainVideo.onerror = () => {
                reject('Native Error');
            };

            mainVideo.play().catch(() => { });

            setTimeout(() => {
                if (mainVideo.paused && mainVideo.readyState < 3) {
                    reject('Native Timeout');
                }
            }, 10000);
        });
    };

    const loadAndPlayVideo = async () => {
        const rawUrl = videoUrlInput.value.trim();
        if (!rawUrl) return;

        cleanup();
        videoWrapper.classList.add('active');

        const strategies = [];
        strategies.push(() => tryMpegts(rawUrl));
        strategies.push(() => tryHls(rawUrl));
        strategies.push(() => tryNative(rawUrl));
        strategies.push(() => tryHls(`https://corsproxy.io/?${encodeURIComponent(rawUrl)}`));

        for (const strategy of strategies) {
            try {
                await strategy();
                return;
            } catch (e) {
                cleanup();
            }
        }

        alert('Could not play video. Please check the URL.');
    };

    playBtn.addEventListener('click', loadAndPlayVideo);
    videoUrlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loadAndPlayVideo();
    });
});

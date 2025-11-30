// ==UserScript==
// @name         Workflowy Image Preview & Embed (Final Stable)
// @namespace    http://tampermonkey.net/
// @version      V0.22-Stable
// @description  完美支持图片预览(绕过CSP) + 视频/设计稿嵌入 (Figma, B站, 墨刀等)
// @author       Namkit (Optimized)
// @match        https://workflowy.com/*
// @match        https://beta.workflowy.com/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    // 1. 样式优化：更干净的 Loading 和布局
    GM_addStyle(`
        .wf-media-container {
            display: block;
            margin: 6px 0 8px 0;
            user-select: none;
            pointer-events: auto;
        }
        .wf-media-inner {
            position: relative;
            display: inline-block;
            border-radius: 6px;
            overflow: hidden;
            box-shadow: 0 2px 5px rgba(0,0,0,0.15);
            background: rgba(0,0,0,0.03);
            border: 1px solid rgba(0,0,0,0.05);
            min-height: 40px;
        }
        .wf-preview-img {
            display: block;
            max-width: 600px;
            max-height: 500px;
            height: auto;
            opacity: 0;
            transition: opacity 0.3s ease;
        }
        .wf-preview-img.loaded {
            opacity: 1;
        }
        .wf-loading-text {
            position: absolute;
            top: 50%; left: 50%;
            transform: translate(-50%, -50%);
            font-size: 11px;
            color: #aaa;
            font-family: sans-serif;
            white-space: nowrap;
        }
        .wf-embed-frame {
            border: none;
            display: block;
        }
        @media print { .wf-media-container { display: none; } }
    `);

    const CONFIG = {
        debounceTime: 600,
        previewWidth: 720,
        previewHeight: 450
    };

    // 2. 定义支持的格式
    // 图片正则 (涵盖常见的图床后缀)
    const IMG_REGEX = /https?:\/\/[^\s]+?(?:\.(?:jpg|jpeg|png|gif|svg|webp)|oss-cn|imgur|twimg|wx)(?:\?[^?\s]*)?$/i;

    // 嵌入规则 (保留你 V0.18 的所有规则)
    const EMBED_FORMATS = [
        {
            name: 'Modao',
            regex: /https?:\/\/modao.cc\/app\/([0-9a-zA-Z]+)/i,
            embed: 'https://modao.cc/app/$1/embed/v2'
        },
        {
            name: 'Bilibili-BV',
            regex: /https?:\/\/(?:www\.)?bilibili\.com\/video\/(BV[\w]+)/i,
            embed: '//player.bilibili.com/player.html?bvid=$1&high_quality=1&autoplay=0'
        },
        {
            name: 'Bilibili-Short',
            regex: /https?:\/\/b23\.tv\/(BV[\w]+)/i,
            embed: '//player.bilibili.com/player.html?bvid=$1&high_quality=1&autoplay=0'
        },
        {
            name: 'Bilibili-AV',
            regex: /https?:\/\/(?:www\.)?bilibili\.com\/video\/(av[\d]+)/i,
            embed: '//player.bilibili.com/player.html?aid=$1&high_quality=1&autoplay=0'
        },
        {
            name: 'MasterGo',
            regex: /https?:\/\/mastergo.com\/goto\/([A-Za-z0-9]+)?page_id=([0-9]+):([0-9]+)&file=([0-9]+)/i,
            embed: 'https://mastergo.com/file/$4?page_id=$2:$3&source=iframe_share'
        },
        {
            name: 'Figma',
            regex: /https?:\/\/(?:www\.)?figma.com\/(file|proto|design)\/([0-9a-zA-Z]+)(\/.*)?/i,
            embed: 'https://www.figma.com/embed?embed_host=share&url=https%3A%2F%2Fwww.figma.com%2F$1%2F$2%2F$3&type=design&node-id=0%253A1&mode=design'
        },
        {
            name: 'CoDesign',
            regex: /https?:\/\/codesign.qq.com\/s\/([0-9a-zA-Z]+)/i,
            embed: 'https://codesign.qq.com/embed/$1'
        },
        {
            name: 'YouTube',
            regex: /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/i,
            embed: 'https://www.youtube.com/embed/$1'
        }
    ];

    // 3. 核心：通过 Tampermonkey 下载图片 (绕过 CSP 和 防盗链)
    function fetchImageAsBlob(url, imgElement, container) {
        GM_xmlhttpRequest({
            method: "GET",
            url: url,
            responseType: "blob",
            headers: { "Referer": "https://www.google.com/" }, // 伪造 Referer
            onload: function(response) {
                if (response.status === 200) {
                    const blobUrl = URL.createObjectURL(response.response);
                    imgElement.src = blobUrl;
                    imgElement.onload = () => {
                        imgElement.classList.add('loaded');
                        const loader = container.querySelector('.wf-loading-text');
                        if(loader) loader.remove();
                    };
                } else {
                    handleError(container);
                }
            },
            onerror: function() {
                handleError(container);
            }
        });
    }

    function handleError(container) {
        // 图片加载失败时，安静地移除容器，不要报错打扰用户
        container.remove();
    }

    // 4. 处理节点逻辑
    function processLink(link) {
        // 防止重复处理
        if (link.dataset.wfProcessed) return;
        
        const url = link.href;
        let matchType = null;
        let embedConfig = null;

        // A. 检查是否是图片
        if (IMG_REGEX.test(url)) {
            matchType = 'image';
        } 
        // B. 检查是否是嵌入 (Video/Design)
        else {
            for (const format of EMBED_FORMATS) {
                if (format.regex.test(url)) {
                    matchType = 'embed';
                    embedConfig = format;
                    break;
                }
            }
        }

        if (!matchType) return;
        link.dataset.wfProcessed = "true";

        // 定位：寻找 .content > .name 结构
        const contentNode = link.closest('.content');
        if (!contentNode) return;
        
        // 检查禁用标签 (#no-preview)
        if (contentNode.textContent.includes('#no-preview') || contentNode.textContent.includes('#no-video-preview')) return;

        const parentBlock = contentNode.parentNode; // div.name
        if (!parentBlock) return;

        // 避免重复插入容器
        // Workflowy 的 DOM 结构里，nextSibling 可能是 notes 或 children，我们尽量插在 name 内部的末尾，或者 name 的紧邻下方
        // 为了稳定性，我们插在 name 的末尾 (appendChild)
        
        const container = document.createElement('div');
        container.className = 'wf-media-container';
        container.contentEditable = "false"; // 关键：防误删
        
        const inner = document.createElement('div');
        inner.className = 'wf-media-inner';
        container.appendChild(inner);

        // --- 渲染图片 ---
        if (matchType === 'image') {
            inner.innerHTML = '<span class="wf-loading-text">Loading...</span>';
            const img = new Image();
            img.className = 'wf-preview-img';
            inner.appendChild(img);
            // 走 Blob 通道
            fetchImageAsBlob(url, img, inner);
        } 
        // --- 渲染嵌入 ---
        else if (matchType === 'embed') {
            const iframe = document.createElement('iframe');
            
            // 替换 URL 参数
            let finalEmbedUrl = embedConfig.embed;
            const match = url.match(embedConfig.regex);
            if (match) {
                // 将正则捕获组 $1, $2 等替换到 embed 模板中
                for (let i = 1; i < match.length; i++) {
                    finalEmbedUrl = finalEmbedUrl.replace('$' + i, match[i] || '');
                }
            }

            iframe.src = finalEmbedUrl;
            iframe.className = 'wf-embed-frame';
            iframe.style.width = CONFIG.previewWidth + 'px';
            iframe.style.height = CONFIG.previewHeight + 'px';
            iframe.allowFullscreen = true;
            
            inner.appendChild(iframe);
        }

        // 插入到 DOM
        parentBlock.appendChild(container);
    }

    // 5. 调度器 (防抖 + 监听)
    let timeout = null;
    function run() {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
            const links = document.querySelectorAll('.content a:not([data-wf-processed])');
            if(links.length) links.forEach(processLink);
        }, CONFIG.debounceTime);
    }

    function init() {
        // 启动延迟
        setTimeout(run, 1500);

        // 监听变化
        const observer = new MutationObserver((mutations) => {
            let shouldRun = false;
            for (const m of mutations) {
                // 忽略我们自己造成的 DOM 变动
                if (m.target.className && typeof m.target.className === 'string' && m.target.className.includes('wf-')) continue;
                shouldRun = true;
            }
            if (shouldRun) run();
        });

        const app = document.querySelector('#app') || document.body;
        observer.observe(app, {
            childList: true,
            subtree: true,
            characterData: true
        });

        // 辅助事件
        document.addEventListener('click', () => setTimeout(run, 500));
        document.addEventListener('keydown', (e) => {
            if(e.key === 'Enter') setTimeout(run, 500);
        });
    }

    init();
})();
// ==UserScript==
// @name         Workflowy Image Preview & Embed (Final Stable)
// @namespace    http://tampermonkey.net/
// @version      V0.24-Stable
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
            top: 50%;
            left: 50%;
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
        @media print {
            .wf-media-container {
                display: none;
            }
        }
    `);

    const CONFIG = {
        debounceTime: 600,
        previewWidth: 720,
        previewHeight: 450
    };

    const IMG_REGEX = /https?:\/\/[^\s]+?(?:\.(?:jpg|jpeg|png|gif|svg|webp)|oss-cn|imgur|twimg|wx)(?:\?[^?\s]*)?$/i;

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

    function buildMediaKey(anchorRole, type, url) {
        return `${anchorRole}::${type}::${url}`;
    }

    function findExistingContainer(hostNode, mediaKey) {
        const containers = hostNode.querySelectorAll('.wf-media-container');
        for (const container of containers) {
            if (container.dataset.wfMediaKey === mediaKey) {
                return container;
            }
        }
        return null;
    }

    function resolvePreviewMount(contentNode) {
        const anchorNode = contentNode.closest('.notes') || contentNode.closest('.name') || contentNode.parentNode;
        if (!anchorNode || !anchorNode.parentNode) return null;

        const hostNode = anchorNode.parentNode;
        const hostRect = hostNode.getBoundingClientRect();
        const contentRect = contentNode.getBoundingClientRect();
        const indent = Math.max(0, Math.round(contentRect.left - hostRect.left));
        const anchorRole = anchorNode.classList?.contains('notes')
            ? 'notes'
            : (anchorNode.classList?.contains('name') ? 'name' : 'content');

        return {
            anchorNode,
            hostNode,
            indent,
            anchorRole
        };
    }

    function insertAfter(referenceNode, newNode) {
        if (!referenceNode || !referenceNode.parentNode) return;
        if (referenceNode.nextSibling) {
            referenceNode.parentNode.insertBefore(newNode, referenceNode.nextSibling);
        } else {
            referenceNode.parentNode.appendChild(newNode);
        }
    }

    function insertPreviewContainer(anchorNode, container) {
        let referenceNode = anchorNode;
        while (
            referenceNode.nextSibling &&
            referenceNode.nextSibling.nodeType === 1 &&
            referenceNode.nextSibling.classList?.contains('wf-media-container')
        ) {
            referenceNode = referenceNode.nextSibling;
        }
        insertAfter(referenceNode, container);
    }

    function isOwnMutationNode(node) {
        return !!(
            node &&
            node.nodeType === 1 &&
            (
                node.classList?.contains('wf-media-container') ||
                node.classList?.contains('wf-media-inner') ||
                node.classList?.contains('wf-loading-text') ||
                node.classList?.contains('wf-preview-img') ||
                node.classList?.contains('wf-embed-frame') ||
                node.closest?.('.wf-media-container')
            )
        );
    }

    function fetchImageAsBlob(url, imgElement, container) {
        GM_xmlhttpRequest({
            method: 'GET',
            url: url,
            responseType: 'blob',
            headers: {
                Referer: 'https://www.google.com/'
            },
            onload: function(response) {
                if (response.status === 200) {
                    const blobUrl = URL.createObjectURL(response.response);
                    imgElement.src = blobUrl;
                    imgElement.onload = () => {
                        imgElement.classList.add('loaded');
                        const loader = container.querySelector('.wf-loading-text');
                        if (loader) loader.remove();
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
        container.remove();
    }

    function processLink(link) {
        const url = link.href;
        if (!url) return;

        let matchType = null;
        let embedConfig = null;

        if (IMG_REGEX.test(url)) {
            matchType = 'image';
        } else {
            for (const format of EMBED_FORMATS) {
                if (format.regex.test(url)) {
                    matchType = 'embed';
                    embedConfig = format;
                    break;
                }
            }
        }

        if (!matchType) return;

        const contentNode = link.closest('.content');
        if (!contentNode) return;

        if (
            contentNode.textContent.includes('#no-preview') ||
            contentNode.textContent.includes('#no-video-preview')
        ) {
            return;
        }

        const mount = resolvePreviewMount(contentNode);
        if (!mount) return;

        const { anchorNode, hostNode, indent, anchorRole } = mount;

        const mediaKey = buildMediaKey(anchorRole, matchType, url);
        const existing = findExistingContainer(hostNode, mediaKey);
        if (existing) return;

        const container = document.createElement('div');
        container.className = 'wf-media-container';
        container.dataset.wfMediaKey = mediaKey;
        container.contentEditable = 'false';
        container.style.marginLeft = `${indent}px`;

        const inner = document.createElement('div');
        inner.className = 'wf-media-inner';
        container.appendChild(inner);

        if (matchType === 'image') {
            inner.innerHTML = '<span class="wf-loading-text">Loading...</span>';
            const img = new Image();
            img.className = 'wf-preview-img';
            inner.appendChild(img);
            fetchImageAsBlob(url, img, inner);
        } else if (matchType === 'embed') {
            const iframe = document.createElement('iframe');
            let finalEmbedUrl = embedConfig.embed;
            const match = url.match(embedConfig.regex);

            if (match) {
                for (let i = 1; i < match.length; i += 1) {
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

        insertPreviewContainer(anchorNode, container);
    }

    let timeout = null;

    function run() {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
            const links = document.querySelectorAll('.content a');
            if (links.length) {
                links.forEach(processLink);
            }
        }, CONFIG.debounceTime);
    }

    function init() {
        setTimeout(run, 1500);

        const observer = new MutationObserver((mutations) => {
            let shouldRun = false;

            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
                    if (changedNodes.length && changedNodes.every(isOwnMutationNode)) {
                        continue;
                    }
                }

                if (isOwnMutationNode(mutation.target)) {
                    continue;
                }

                shouldRun = true;
                break;
            }

            if (shouldRun) run();
        });

        const app = document.querySelector('#app') || document.body;
        observer.observe(app, {
            childList: true,
            subtree: true,
            characterData: true
        });

        document.addEventListener('click', () => setTimeout(run, 500));
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') setTimeout(run, 500);
        });
    }

    init();
})();

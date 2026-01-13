/**
 * static/js/components/wiDetailPopup.js
 * 世界书详情弹窗组件 (对应 detail_wi_popup.html)
 */

import { wiHelpers } from '../utils/wiHelpers.js';
import { deleteWorldInfo, getWorldInfoDetail } from '../api/wi.js';
import { getCardDetail } from '../api/card.js';
import { normalizeWiBook } from '../utils/data.js';
import { formatWiKeys, estimateTokens, getTotalWiTokens } from '../utils/format.js';

export default function wiDetailPopup() {
    return {
        // === 本地状态 ===
        showWiDetailModal: false,
        activeWiDetail: null, // 当前查看的 WI 对象 (包含 id, name, type, path 等)

        // 阅览室数据
        isLoading: false,
        wiData: null,         // 完整的 WI 对象
        wiEntries: [],        // 归一化后的条目数组
        description: "",      // 世界书描述
        
        // 搜索过滤
        searchTerm: "",
        activeEntry: null,

        // 引入工具函数
        formatWiKeys,
        estimateTokens,
        ...wiHelpers,

        init() {
            // 监听打开事件 (通常由 wiGrid 触发)
            window.addEventListener('open-wi-detail-modal', (e) => {
                this.activeWiDetail = e.detail;
                this.showWiDetailModal = true;
                this.searchTerm = "";
                this.activeEntry = null
                this.loadContent();
            });
            
            // 监听关闭事件 (如果其他组件需要强制关闭它)
            window.addEventListener('close-wi-detail-modal', () => {
                this.showWiDetailModal = false;
            });
        },

        // === 计算属性 ===

        get filteredEntries() {
            if (!this.searchTerm) return this.wiEntries;
            const lower = this.searchTerm.toLowerCase();
            return this.wiEntries.filter(e => {
                const keys = Array.isArray(e.keys) ? e.keys.join(' ') : (e.keys || '');
                const content = e.content || '';
                const comment = e.comment || '';
                return keys.toLowerCase().includes(lower) || 
                       content.toLowerCase().includes(lower) ||
                       comment.toLowerCase().includes(lower);
            });
        },

        // 格式化时间戳
        formatDate(timestamp) {
            if (!timestamp) return '';
            return new Date(timestamp * 1000).toLocaleString();
        },

        get totalTokens() {
            return getTotalWiTokens(this.wiEntries);
        },

        // 选中某个条目查看详情
        selectEntry(entry) {
            this.activeEntry = entry;
        },

        async loadContent() {
            if (!this.activeWiDetail) return;
            this.isLoading = true;
            this.wiEntries = [];
            this.description = "";

            try {
                let rawData = null;

                // 1. 如果是嵌入式，读取角色卡
                if (this.activeWiDetail.type === 'embedded') {
                    const res = await getCardDetail(this.activeWiDetail.card_id);
                    if (res.success && res.card) {
                        rawData = res.card.character_book;
                        this.description = res.card.description || ""; // 嵌入式可能显示角色描述? 或者不显示
                    }
                } 
                // 2. 如果是独立文件 (Global/Resource)
                else {
                    const res = await getWorldInfoDetail({
                        id: this.activeWiDetail.id,
                        source_type: this.activeWiDetail.type,
                        file_path: this.activeWiDetail.path
                    });
                    if (res.success) {
                        rawData = res.data;
                    }
                }

                if (rawData) {
                    // 归一化处理 (复用 utils/data.js)
                    const book = normalizeWiBook(rawData, this.activeWiDetail.name);
                    this.wiData = book;
                    // 确保是数组
                    this.wiEntries = Array.isArray(book.entries) ? book.entries : Object.values(book.entries || {});
                    // 尝试提取描述字段 (V3 标准可能有 description)
                    if (book.description) this.description = book.description;
                }

            } catch (err) {
                console.error("Failed to load WI detail:", err);
            } finally {
                this.isLoading = false;
            }
        },

        // === 交互逻辑 ===

        // 删除当前世界书
        deleteCurrentWi() {
            if (!this.activeWiDetail) return;
            
            // 双重保险：如果是嵌入式，直接返回
            if (this.activeWiDetail.type === 'embedded') {
                alert("无法直接删除内嵌世界书，请去角色卡编辑界面操作。");
                return;
            }

            const name = this.activeWiDetail.name || "该世界书";
            if (!confirm(`⚠️ 确定要删除 "${name}" 吗？\n文件将被移至回收站。`)) return;

            deleteWorldInfo(this.activeWiDetail.path)
                .then(res => {
                    if (res.success) {
                        this.showWiDetailModal = false;
                        // 刷新列表
                        window.dispatchEvent(new CustomEvent('refresh-wi-list'));
                        // 可选：显示 Toast
                        // this.$store.global.showToast("🗑️ 已删除"); 
                    } else {
                        alert("删除失败: " + res.msg);
                    }
                })
                .catch(err => alert("请求错误: " + err));
        },

        // 联动跳转编辑器
        enterWiEditorFromDetail(specificEntry = null) {
            const targetEntry = specificEntry || this.activeEntry;
            
            let jumpToIndex = 0;
            if (targetEntry && this.wiEntries.length > 0) {
                // 1. 优先尝试直接对象引用匹配 (最准确)
                let idx = this.wiEntries.indexOf(targetEntry);
                
                // 2. 如果引用匹配失败 (极少见，防Proxy问题)，尝试 ID 匹配
                if (idx === -1 && targetEntry.id) {
                    idx = this.wiEntries.findIndex(e => e.id === targetEntry.id);
                }
                
                // 3. 如果 ID 也没有或匹配失败，尝试 "指纹" 匹配 (内容+备注+关键词)
                if (idx === -1) {
                    idx = this.wiEntries.findIndex(e => 
                        e.content === targetEntry.content && 
                        e.comment === targetEntry.comment &&
                        JSON.stringify(e.keys) === JSON.stringify(targetEntry.keys)
                    );
                }

                if (idx !== -1) {
                    jumpToIndex = idx;
                }
            }

            this.showWiDetailModal = false;
            
            // 构造事件数据
            const detailData = { 
                ...this.activeWiDetail,
                jumpToIndex: jumpToIndex 
            };

            window.dispatchEvent(new CustomEvent('open-wi-editor', { 
                detail: detailData 
            }));
        },

        // 打开时光机 (Rollback)
        openRollback() {
            this.showWiDetailModal = false; // 关闭当前小弹窗

            this.handleOpenRollback(this.activeWiDetail, null);
        }
    }
}
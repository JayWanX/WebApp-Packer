'use strict';

const $ = (id) => document.getElementById(id);

(async function init() {
  $('btnInfo').addEventListener('click', async () => {
    if (!window.desktopAPI) {
      $('info').textContent = '未在桌面环境中运行（普通浏览器）';
      return;
    }
    const info = await window.desktopAPI.getInfo();
    $('info').textContent = JSON.stringify(info, null, 2);
  });

  $('btnSave').addEventListener('click', async () => {
    if (!window.desktopAPI || !window.desktopAPI.saveAs) {
      $('fs').textContent = '本地文件 API 不可用';
      return;
    }
    try {
      const path = await window.desktopAPI.saveAs(
        'note.txt',
        '由 WebApp Packer 测试页保存\n时间: ' + new Date().toISOString(),
        [{ name: '文本', extensions: ['txt'] }]
      );
      $('fs').textContent = path ? '已保存到: ' + path : '用户取消';
    } catch (err) {
      $('fs').textContent = '错误: ' + err.message;
    }
  });

  $('btnOpen').addEventListener('click', async () => {
    if (!window.desktopAPI || !window.desktopAPI.openAs) {
      $('fs').textContent = '本地文件 API 不可用';
      return;
    }
    try {
      const result = await window.desktopAPI.openAs([{ name: '文本', extensions: ['txt', 'md'] }]);
      $('fs').textContent = result
        ? '已打开: ' + result.path + '\n\n' + result.content
        : '用户取消';
    } catch (err) {
      $('fs').textContent = '错误: ' + err.message;
    }
  });

  $('btnDir').addEventListener('click', async () => {
    if (!window.desktopAPI || !window.desktopAPI.dialog) return;
    const dir = await window.desktopAPI.dialog.selectDirectory({
      title: '选择一个目录'
    });
    $('fs').textContent = dir ? '已选择: ' + dir : '用户取消';
  });

  $('btnStoreSet').addEventListener('click', async () => {
    if (!window.desktopAPI) return;
    const key = $('storeKey').value;
    const val = $('storeVal').value;
    await window.desktopAPI.store.set(key, val);
    $('store').textContent = '已写入: ' + key + ' = ' + val;
  });

  $('btnStoreGet').addEventListener('click', async () => {
    if (!window.desktopAPI) return;
    const key = $('storeKey').value;
    const val = await window.desktopAPI.store.get(key);
    $('store').textContent = '读取: ' + key + ' = ' + JSON.stringify(val);
  });
})();

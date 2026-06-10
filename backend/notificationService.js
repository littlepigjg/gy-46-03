function formatAlertMessage(alert, urlRecord) {
  const changeDescriptions = (JSON.parse(alert.change_types || '[]'))
    .map(c => `${c.description}(${Math.round(c.severity * 100)}%)`)
    .join(', ') || '未检测到具体变化类型';

  return {
    subject: `[网页监控告警] ${urlRecord.name} 检测到页面变化`,
    changeDescriptions,
    overallScore: alert.overall_score,
    layoutScore: alert.layout_score,
    contentScore: alert.content_score,
    styleScore: alert.style_score
  };
}

function recordNotification(db, alertId, channel, status, errorMessage = null) {
  const stmt = db.prepare(`
    INSERT INTO notifications (alert_id, channel, status, error_message)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(alertId, channel, status, errorMessage);
}

export function sendInAppNotification(db, alert, urlRecord) {
  try {
    recordNotification(db, alert.id, 'in_app', 'sent');
    console.log(`[告警] 站内通知已创建: ${urlRecord.name} - 告警ID=${alert.id}`);
    return { success: true, channel: 'in_app' };
  } catch (err) {
    console.error('[告警] 站内通知失败:', err.message);
    recordNotification(db, alert.id, 'in_app', 'failed', err.message);
    return { success: false, channel: 'in_app', error: err.message };
  }
}

export function sendEmailNotification(db, alert, urlRecord, emailAddress) {
  if (!emailAddress) {
    return { success: false, channel: 'email', error: '未配置邮箱地址' };
  }

  try {
    const { subject, changeDescriptions, overallScore, layoutScore, contentScore, styleScore } =
      formatAlertMessage(alert, urlRecord);

    const body = `
监控页面: ${urlRecord.name}
URL: ${urlRecord.url}
告警时间: ${new Date().toLocaleString('zh-CN')}

变化类型: ${changeDescriptions}
总体差异度: ${Math.round(overallScore * 100)}%
  - 布局变化: ${Math.round(layoutScore * 100)}%
  - 内容变化: ${Math.round(contentScore * 100)}%
  - 样式变化: ${Math.round(styleScore * 100)}%

请登录系统查看详细对比截图。

---
网页截图归档工具自动发送
    `.trim();

    console.log(`[告警] 邮件通知 (模拟): To=${emailAddress}, Subject=${subject}`);
    console.log(`[告警] 邮件内容摘要: ${body.substring(0, 200)}...`);

    recordNotification(db, alert.id, 'email', 'sent');
    return { success: true, channel: 'email' };
  } catch (err) {
    console.error('[告警] 邮件通知失败:', err.message);
    recordNotification(db, alert.id, 'email', 'failed', err.message);
    return { success: false, channel: 'email', error: err.message };
  }
}

export function dispatchNotifications(db, alert, urlRecord, rule) {
  const results = [];
  if (rule.notify_in_app) {
    results.push(sendInAppNotification(db, alert, urlRecord));
  }
  if (rule.notify_email) {
    results.push(sendEmailNotification(db, alert, urlRecord, rule.email_address));
  }
  return results.filter(r => r.success).map(r => r.channel);
}

export default {
  sendInAppNotification,
  sendEmailNotification,
  dispatchNotifications,
  formatAlertMessage
};

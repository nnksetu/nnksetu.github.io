import os
import requests
import json

# 从 GitHub Secrets 读取
TOKEN = os.environ['TELEGRAM_BOT_TOKEN']
CHAT_ID = os.environ['TELEGRAM_GROUP_CHAT_ID']

# 调用 Telegram API 获取最近消息
url = f"https://api.telegram.org/bot{TOKEN}/getUpdates"
response = requests.get(url).json()

print("=== Bot 正在检查 Telegram 群组消息 ===")

if response.get('ok'):
    updates = response['result']
    if not updates:
        print("没有新消息（可能刚开始，或者需要先在群里发消息触发）")
    else:
        # 只显示最后 10 条消息，避免日志太长
        for update in updates[-10:]:
            if 'message' in update:
                msg = update['message']
                chat_id = msg['chat']['id']
                if str(chat_id) == CHAT_ID:  # 只看目标群组
                    sender = msg.get('from', {}).get('first_name', '未知')
                    text = msg.get('text', '(无文本，可能是有文件)')
                    date = msg['date']
                    
                    print(f"【匹配群组】时间: {date}")
                    print(f"   发送者: {sender}")
                    print(f"   内容: {text}")
                    
                    # 如果有附件（压缩包）
                    if 'document' in msg:
                        file_name = msg['document']['file_name']
                        file_size = msg['document']['file_size']
                        print(f"   📎 附件文件: {file_name} (大小: {file_size / 1024:.1f} KB)")
                    
                    # 如果消息里有 .zip 链接
                    if text and '.zip' in text:
                        print(f"   🔗 检测到可能包含压缩包链接的文本")
    print("=== 检查完成 ===")
else:
    print("API 调用失败！可能原因：")
    print("- Token 写错了")
    print("- 网络问题")
    print("- Bot 没有加入群组或没有管理员权限")
    print("完整错误:", response)

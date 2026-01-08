import os
import requests
from datetime import datetime

# 从 Secrets 读取
TOKEN = os.environ['TELEGRAM_BOT_TOKEN']
CHAT_ID = os.environ['TELEGRAM_CHANNEL_CHAT_ID']          # 频道 Chat ID
CHANNEL_USERNAME = "setutime_pipi"                        # 你的频道用户名（不带 @）

def get_file_download_url(file_id):
    """根据 file_id 获取永久文件下载链接"""
    url = f"https://api.telegram.org/bot{TOKEN}/getFile?file_id={file_id}"
    resp = requests.get(url).json()
    if resp['ok']:
        file_path = resp['result']['file_path']
        return f"https://api.telegram.org/file/bot{TOKEN}/{file_path}"
    else:
        return "(获取失败)"

def main():
    print("=== 开始测试读取频道消息 ===")
    print(f"频道用户名: @{CHANNEL_USERNAME}")
    print(f"频道 Chat ID: {CHAT_ID}")
    print(f"测试时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} JST\n")

    offset = None
    found_messages = 0
    found_files = 0

    while True:
        params = {'offset': offset, 'limit': 50, 'timeout': 10}
        response = requests.get(
            f"https://api.telegram.org/bot{TOKEN}/getUpdates",
            params=params
        ).json()

        if not response['ok']:
            print("API 调用失败:", response)
            break

        updates = response['result']
        if not updates:
            print("已扫描完所有历史消息")
            break

        for update in updates:
            # 频道消息在 channel_post 字段
            post = update.get('channel_post')
            if not post:
                continue

            chat_id = post['chat']['id']
            if str(chat_id) != CHAT_ID:
                continue

            found_messages += 1
            msg_id = post['message_id']
            message_link = f"https://t.me/{CHANNEL_USERNAME}/{msg_id}"

            text = post.get('text') or post.get('caption') or '(无文字)'

            print(f"✅ 读取到消息 {msg_id}")
            print(f"   消息链接: {message_link}")
            print(f"   文字内容: {text[:100]}{'...' if len(text)>100 else ''}")

            # 如果有压缩包文件
            if 'document' in post:
                doc = post['document']
                file_name = doc.get('file_name', '(未知文件名)')
                file_id = doc['file_id']
                file_url = get_file_download_url(file_id)

                found_files += 1
                print(f"   📦 压缩包文件名: {file_name}")
                print(f"   📎 文件直链: {file_url}")
            print("")  # 空行分隔

        # 继续拉取更早的消息
        if updates:
            offset = updates[-1]['update_id'] + 1

    print(f"=== 测试完成 ===")
    print(f"共读取到频道消息: {found_messages} 条")
    print(f"其中带有压缩包的文件消息: {found_files} 条")

if __name__ == '__main__':
    main()

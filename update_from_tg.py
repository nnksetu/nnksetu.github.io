import os
import requests
import re
from datetime import datetime

TOKEN = os.environ['TELEGRAM_BOT_TOKEN']
CHAT_ID = os.environ['TELEGRAM_CHANNEL_CHAT_ID']  # 改成频道的 -100xxx
CHANNEL_USERNAME = "setutime_pipi"  # 你的频道用户名（不带@），用于拼链接

# 正则提取期号：支持 "第37期" "第 37 期" 等常见写法
PATTERN = re.compile(r'第\s*(\d+)\s*期')

found_issues = {}

def get_file_download_url(file_id):
    url = f"https://api.telegram.org/bot{TOKEN}/getFile?file_id={file_id}"
    resp = requests.get(url).json()
    if resp['ok']:
        file_path = resp['result']['file_path']
        return f"https://api.telegram.org/file/bot{TOKEN}/{file_path}"
    return None

def main():
    print("=== 开始扫描 Telegram 频道历史消息 ===")
    print(f"频道用户名: @{CHANNEL_USERNAME}")
    print(f"频道 Chat ID: {CHAT_ID}\n")

    offset = None
    processed = 0
    found = 0

    while True:
        params = {'offset': offset, 'limit': 100, 'timeout': 10}
        if offset is None:
            params['offset'] = -100

        response = requests.get(
            f"https://api.telegram.org/bot{TOKEN}/getUpdates",
            params=params
        ).json()

        if not response['ok']:
            print("API 错误:", response)
            break

        updates = response['result']
        if not updates:
            print("已拉取完所有历史消息")
            break

        for update in updates:
            processed += 1

            # 关键：频道消息在 channel_post 字段
            post = update.get('channel_post')
            if not post:
                continue

            chat_id = post['chat']['id']
            if str(chat_id) != CHAT_ID:
                continue

            msg_id = post['message_id']
            message_link = f"https://t.me/{CHANNEL_USERNAME}/{msg_id}"

            text = post.get('text') or post.get('caption') or ''  # 图文消息用 caption

            # 提取期号
            match = PATTERN.search(text)
            if not match:
                # 如果文本没期号，尝试从文件名提取（如果有文件）
                if 'document' in post:
                    file_name = post['document'].get('file_name', '')
                    match = PATTERN.search(file_name)
                else:
                    continue

            issue_num = match.group(1)

            # 获取文件直链（可选）
            file_url = None
            if 'document' in post:
                file_id = post['document']['file_id']
                file_url = get_file_download_url(file_id)

            found_issues[issue_num] = {
                'message_link': message_link,
                'file_url': file_url or "(无文件或链接获取失败)",
                'msg_id': msg_id,
                'date': post['date']
            }
            found += 1

            print(f"✅ 第 {issue_num} 期")
            print(f"   消息链接: {message_link}")
            print(f"   文件直链: {file_url or '无文件'}")
            print(f"   对应 HTML: /setu/{issue_num}.html\n")

        if updates:
            offset = updates[-1]['update_id'] + 1

    print(f"=== 扫描完成 ===")
    print(f"处理消息: {processed} 条，找到有效期数: {found} 个")
    print("\n汇总（按期号排序）：")
    for issue in sorted(found_issues.keys(), key=int):
        info = found_issues[issue]
        print(f"第 {issue} 期 → {info['message_link']}")

if __name__ == '__main__':
    main()

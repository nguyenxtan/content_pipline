# YouTube video analytics notes

Date: 2026-05-28

## Goal

After a video is uploaded to YouTube, keep enough YouTube-side metadata and stats in the app for later analysis without relying only on the local generated content record.

The app already stores `platformVideoId`, `platformVideoUrl`, `contentId`, `channelId`, `videoType`, and upload status in `upload_queue`. Use `platformVideoId` as the source of truth instead of parsing the URL whenever possible.

## Recommended data collection

Use the YouTube Data API `videos.list` endpoint for lightweight snapshots:

- `part=snippet,statistics,contentDetails,status`
- `id=<youtubeVideoId>`

Store snapshots in a separate table so stats can be tracked over time:

```sql
youtube_video_snapshots
- id
- content_id
- upload_queue_id
- youtube_video_id
- video_url
- title
- description
- published_at
- duration_seconds
- privacy_status
- view_count
- like_count
- comment_count
- thumbnail_url
- raw_json
- fetched_at
```

Suggested flow:

1. Immediately after upload succeeds, call `videos.list` once and save an initial snapshot.
2. Add a cron refresh for uploaded videos from the last 7-30 days.
3. Refresh more frequently for newly uploaded videos, less frequently for older videos.
4. Add YouTube Analytics API later for deeper metrics such as watch time, retention, traffic sources, and subscriber changes by video.

## Shorts thumbnail note

YouTube Shorts should not be handled like long-form videos for custom thumbnails.

Current official YouTube Help says:

- For Shorts, you cannot upload a custom thumbnail image like long-form videos.
- You can select a frame from the Short as the thumbnail.
- The selected Short thumbnail appears in search results, hashtag/audio pages, and the channel page.
- Thumbnail selection/editing for Shorts is done from the YouTube mobile app, not Studio.

Practical implementation direction for this app:

- Do not spend quota/API work trying to upload a separate custom thumbnail for Shorts.
- If thumbnail control is important, render a strong cover frame inside the Short itself, ideally at the start or a known frame.
- Keep important text/subject centered because Shorts thumbnails/covers may be cropped differently across surfaces.
- Continue generating and uploading custom thumbnails for long-form videos only.


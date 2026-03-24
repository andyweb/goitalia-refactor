// External API response types to reduce `any` usage

export interface TelegramUpdate {
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: { id: number; first_name: string; last_name?: string; username?: string };
    text?: string;
    audio?: { file_id: string; duration: number };
    voice?: { file_id: string; duration: number };
    photo?: Array<{ file_id: string; width: number; height: number }>;
    document?: { file_id: string; file_name?: string; mime_type?: string };
  };
}

export interface FacebookPost {
  id: string;
  message?: string;
  full_picture?: string;
  permalink_url?: string;
  created_time: string;
  likes?: { summary: { total_count: number } };
  comments?: { summary: { total_count: number } };
}

export interface InstagramMedia {
  id: string;
  caption?: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  media_url?: string;
  thumbnail_url?: string;
  permalink: string;
  timestamp: string;
  like_count?: number;
  comments_count?: number;
}

export interface LinkedInPost {
  id?: string;
  urn?: string;
  commentary?: string;
  content?: { media?: { title?: string; id?: string } };
  createdAt?: number;
  publishedAt?: number;
}

export interface LinkedInProfile {
  sub?: string;
  name?: string;
  email?: string;
  picture?: string;
}

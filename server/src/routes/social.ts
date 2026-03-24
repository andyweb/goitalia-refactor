import { Router } from "express";
import type { Db } from "@goitalia/db";
import { companySecrets } from "@goitalia/db";
import { eq, and } from "drizzle-orm";
import crypto from "node:crypto";

function getKeyHash(): Buffer {
  const key = process.env.GOITALIA_SECRET_KEY || process.env.BETTER_AUTH_SECRET || "goitalia-default-key-change-me";
  return crypto.createHash("sha256").update(key).digest();
}
function decrypt(text: string): string {
  const [ivHex, enc] = text.split(":");
  if (!ivHex || !enc) throw new Error("Invalid");
  const d = crypto.createDecipheriv("aes-256-cbc", getKeyHash(), Buffer.from(ivHex, "hex"));
  let r = d.update(enc, "hex", "utf8"); r += d.final("utf8");
  return r;
}

interface SocialPost {
  id: string;
  platform: string;
  type: string;
  text: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  permalink?: string;
  timestamp: string;
  accountName: string;
  likes?: number;
  comments?: number;
}

export function socialRoutes(db: Db) {
  const router = Router();

  router.get("/social/posts", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const platform = req.query.platform as string;
    if (!companyId) { res.json({ posts: [] }); return; }

    const posts: SocialPost[] = [];

    // Fetch Instagram + Facebook posts
    if (!platform || platform === "instagram" || platform === "facebook") {
      const metaSecret = await db.select().from(companySecrets)
        .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "meta_tokens")))
        .then((rows) => rows[0]);

      if (metaSecret?.description) {
        try {
          const meta = JSON.parse(decrypt(metaSecret.description));

          // Instagram posts
          if (!platform || platform === "instagram") {
            for (const ig of (meta.instagram || [])) {
              try {
                const r = await fetch(`https://graph.facebook.com/v21.0/${ig.id}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count&limit=20&access_token=${meta.accessToken}`);
                if (r.ok) {
                  const data = await r.json() as { data?: any[] };
                  for (const post of (data.data || [])) {
                    posts.push({
                      id: "ig_" + post.id,
                      platform: "instagram",
                      type: post.media_type === "VIDEO" ? "video" : post.media_type === "CAROUSEL_ALBUM" ? "carousel" : "image",
                      text: post.caption || "",
                      mediaUrl: post.media_url,
                      thumbnailUrl: post.thumbnail_url,
                      permalink: post.permalink,
                      timestamp: post.timestamp,
                      accountName: "@" + ig.username,
                      likes: post.like_count,
                      comments: post.comments_count,
                    });
                  }
                }
              } catch (err) { console.error("IG fetch error:", err); }
            }
          }

          // Facebook page posts
          if (!platform || platform === "facebook") {
            for (const page of (meta.pages || [])) {
              try {
                const r = await fetch(`https://graph.facebook.com/v21.0/${page.id}/posts?fields=id,message,full_picture,permalink_url,created_time,likes.summary(true),comments.summary(true)&limit=20&access_token=${page.accessToken}`);
                if (r.ok) {
                  const data = await r.json() as { data?: any[] };
                  for (const post of (data.data || [])) {
                    posts.push({
                      id: "fb_" + post.id,
                      platform: "facebook",
                      type: post.full_picture ? "image" : "text",
                      text: post.message || "",
                      mediaUrl: post.full_picture,
                      permalink: post.permalink_url,
                      timestamp: post.created_time,
                      accountName: page.name,
                      likes: post.likes?.summary?.total_count,
                      comments: post.comments?.summary?.total_count,
                    });
                  }
                }
              } catch (err) { console.error("FB fetch error:", err); }
            }
          }
        } catch {}
      }
    }

    // LinkedIn posts
    if (!platform || platform === "linkedin") {
      const liSecret = await db.select().from(companySecrets)
        .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "linkedin_tokens")))
        .then((rows) => rows[0]);

      if (liSecret?.description) {
        try {
          const li = JSON.parse(decrypt(liSecret.description));
          // Get posts from LinkedIn
          const r = await fetch(`https://api.linkedin.com/v2/ugcPosts?q=authors&authors=List(urn%3Ali%3Aperson%3A${li.sub})&count=20`, {
            headers: { Authorization: "Bearer " + li.accessToken, "X-Restli-Protocol-Version": "2.0.0" },
          });
          if (r.ok) {
            const data = await r.json() as { elements?: any[] };
            for (const post of (data.elements || [])) {
              const text = post.specificContent?.["com.linkedin.ugc.ShareContent"]?.shareCommentary?.text || "";
              const media = post.specificContent?.["com.linkedin.ugc.ShareContent"]?.shareMediaCategory;
              let mediaUrl = "";
              const mediaItems = post.specificContent?.["com.linkedin.ugc.ShareContent"]?.media || [];
              if (mediaItems.length > 0) {
                mediaUrl = mediaItems[0].originalUrl || mediaItems[0].thumbnails?.[0]?.url || "";
              }
              posts.push({
                id: "li_" + post.id,
                platform: "linkedin",
                type: media === "VIDEO" ? "video" : media === "IMAGE" ? "image" : "text",
                text,
                mediaUrl: mediaUrl || undefined,
                permalink: `https://www.linkedin.com/feed/update/${post.id}`,
                timestamp: new Date(post.created?.time || Date.now()).toISOString(),
                accountName: li.name || "LinkedIn",
              });
            }
          }
        } catch (err) { console.error("LinkedIn fetch error:", err); }
      }
    }

    // Sort by timestamp desc
    posts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    res.json({ posts });
  });

  return router;
}

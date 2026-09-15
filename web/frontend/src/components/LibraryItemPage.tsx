import { useEffect, useState } from "react";
import QgifPreview from "./QgifPreview";
import type { User } from "../types";

interface Item {
  id: string;
  filename: string;
  uploader: string;
  uploaderPublicId: string;
  uploadedAt: string;
  size: number;
  frameCount: number;
  downloadCount?: number;
  starCount?: number;
  tags?: string[];
}

interface Props {
  id: string;
  apiUrl: string;
  user: User | null;
  onBack: () => void;
  onUploader: (uploaderPublicId: string) => void;
  onTag: (tag: string) => void;
}

export default function LibraryItemPage({ id, apiUrl, user, onBack, onUploader, onTag }: Props) {
  const [item, setItem] = useState<Item | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${apiUrl}/api/library/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Not found"))))
      .then((d) => {
        if (!cancelled) setItem(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed");
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, id]);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    fetch(`${apiUrl}/api/library/${id}/raw`)
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        if (cancelled) return;
        url = URL.createObjectURL(new Blob([buf], { type: "application/octet-stream" }));
        setBlobUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [apiUrl, id]);

  const copyLink = async () => {
    const link = `${window.location.origin}/library/${id}`;
    try {
      await navigator.clipboard.writeText(link);
      setMsg("Link copied");
    } catch {
      setMsg(link);
    }
  };

  const saveTags = async () => {
    if (!item || !user) return;
    const tags = tagInput
      .split(/[,\s]+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 8);
    const res = await fetch(`${apiUrl}/api/library/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to save tags");
      return;
    }
    setItem({ ...item, tags: data.tags || tags });
    setMsg("Tags saved");
  };

  useEffect(() => {
    if (item?.tags) setTagInput((item.tags || []).join(", "));
  }, [item]);

  if (error && !item) {
    return (
      <div className="library-page">
        <button type="button" className="btn-secondary" onClick={onBack}>
          Back
        </button>
        <p className="page-error">{error}</p>
      </div>
    );
  }

  if (!item) {
    return <div className="library-page">Loading...</div>;
  }

  const isOwner = !!user && user.publicUserId === item.uploaderPublicId;

  return (
    <div className="library-page library-item-page">
      <div className="library-header">
        <button type="button" className="btn-secondary" onClick={onBack}>
          Back to library
        </button>
      </div>
      <h1 className="library-title">{item.filename}</h1>
      <div className="library-item-preview">
        {blobUrl ? <QgifPreview src={blobUrl} /> : <div className="library-empty">Loading preview...</div>}
      </div>
      <p className="page-sub">
        {item.frameCount} frames · by{" "}
        <button type="button" className="btn-text" onClick={() => onUploader(item.uploaderPublicId)}>
          {item.uploader}
        </button>
      </p>
      <div className="chip-row">
        {(item.tags || []).map((t) => (
          <button key={t} type="button" className="chip" onClick={() => onTag(t)}>
            #{t}
          </button>
        ))}
      </div>
      {isOwner && (
        <div className="dash-form-row">
          <input
            className="text-input"
            placeholder="tags, comma separated (max 8)"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
          />
          <button type="button" className="btn-primary" onClick={() => void saveTags()}>
            Save tags
          </button>
        </div>
      )}
      <div className="btn-row">
        <button type="button" className="btn-primary" onClick={() => void copyLink()}>
          Copy link
        </button>
        <a className="btn-secondary" href={`${apiUrl}/api/library/${id}/download`}>
          Download
        </a>
      </div>
      {msg && <p className="page-sub">{msg}</p>}
    </div>
  );
}
// src/services/article-service.ts
'use server';

import { getAdminDb } from '@/lib/firebase-admin';
import { assertUser } from '@/lib/api-auth';
import type { Article } from '@/models/types';
import { Timestamp } from 'firebase-admin/firestore';

// Server Actions, so public endpoints — this module is imported by
// src/app/(app)/articles/page.tsx. Articles are an authenticated-athlete
// surface (any signed-in user can generate one when a search finds nothing),
// so these take assertUser rather than assertAdmin — but unauthenticated they
// were an open Firestore write and an open full-collection read.
//
// Resolved lazily: at module scope this threw at import time when
// FIREBASE_SERVICE_ACCOUNT_KEY was unset, turning a config problem into a
// module-load crash.
const articlesCollection = () => getAdminDb().collection('articles');

/** Ceiling on the client-side-filter search scan (see searchArticles). */
const SEARCH_SCAN_LIMIT = 500;

/**
 * Creates a new article in Firestore.
 */
export async function createArticle(data: Omit<Article, 'id' | 'createdAt'>): Promise<string> {
  // Tight limit: each call is an AI generation plus a write.
  await assertUser('articles:create', { max: 5 });
  const articleData = {
    ...data,
    createdAt: Timestamp.now(),
  };
  const docRef = await articlesCollection().add(articleData);
  return docRef.id;
}

/**
 * Fetches an article by its ID.
 */
export async function getArticle(articleId: string): Promise<Article | null> {
    await assertUser('articles:get', { max: 60 });
    const docRef = articlesCollection().doc(articleId);
    const docSnap = await docRef.get();
    if (docSnap.exists) {
        const data = docSnap.data();
        if (data) {
             return { 
                id: docSnap.id, 
                ...data,
                createdAt: (data.createdAt as Timestamp).toDate(),
            } as Article;
        }
    }
    return null;
}

/**
 * Searches for articles based on a query string.
 * This is a simple search that checks for matches in the title and tags.
 */
export async function searchArticles(query: string): Promise<Article[]> {
  await assertUser('articles:search', { max: 30 });
  if (!query) {
    // If query is empty, return the 12 most recent articles
    const snapshot = await articlesCollection().orderBy('createdAt', 'desc').limit(12).get();
    return snapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data(),
        createdAt: (doc.data().createdAt as Timestamp).toDate(),
    } as Article));
  }

  const lowerCaseQuery = query.toLowerCase();

  // As Firestore doesn't support full-text search natively without extensions,
  // we'll fetch articles and filter them on the server.
  //
  // Capped rather than unbounded: this runs on a user-triggerable path, and
  // createArticle can grow the collection, so "read everything" was a scan whose
  // cost any caller could inflate. Newest-first, so the cap drops the oldest
  // articles from the searchable window rather than returning an arbitrary slice.
  // For real search at volume, a normalised `searchTerms` array field queried
  // with array-contains keeps this in Firestore; an external index is only
  // needed beyond that.
  const snapshot = await articlesCollection()
    .orderBy('createdAt', 'desc')
    .limit(SEARCH_SCAN_LIMIT)
    .get();
  
  const articles: Article[] = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    const article = { 
        id: doc.id, 
        ...data,
        createdAt: (data.createdAt as Timestamp).toDate(),
    } as Article;
    
    const titleMatch = article.title.toLowerCase().includes(lowerCaseQuery);
    const tagMatch = article.tags.some(tag => tag.toLowerCase().includes(lowerCaseQuery));
    
    if (titleMatch || tagMatch) {
      articles.push(article);
    }
  });

  return articles;
}

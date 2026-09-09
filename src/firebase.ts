// src/firebase.ts
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

// 2단계에서 복사한 본인의 설정 값으로 대체하세요.
const firebaseConfig = {
  apiKey: "AIzaSyD8ke4Vpn6kXvQgTxWg370DXQYKqukNe4Y",
  authDomain: "einklang-ae72c.firebaseapp.com",
  projectId: "einklang-ae72c",
  storageBucket: "einklang-ae72c.firebasestorage.app",
  messagingSenderId: "945553425696",
  appId: "1:945553425696:web:35392ff2d4c7c1ae628345",
  measurementId: "G-N5J3EG6555"
};

// Firebase 초기화
const app = initializeApp(firebaseConfig);

// Firestore 데이터베이스 객체 내보내기
export const db = getFirestore(app);
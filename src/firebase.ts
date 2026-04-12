import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyBPqlJ2l_nimGCG27NLqqGuHFsVCpw0pek",
  authDomain: "programme-d-entrainement-d85fb.firebaseapp.com",
  projectId: "programme-d-entrainement-d85fb",
  storageBucket: "programme-d-entrainement-d85fb.firebasestorage.app",
  messagingSenderId: "1074927335146",
  appId: "1:1074927335146:web:aa2522aa7d6385a7ad8993",
  measurementId: "G-WVTHW6DJ8N"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

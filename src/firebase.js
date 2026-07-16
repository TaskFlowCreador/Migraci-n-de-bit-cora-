import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyC152bnS9qB_BechoJ7l0TdbXQxvhgDBu4",
  authDomain: "coop-taxi-portoviejo.firebaseapp.com",
  projectId: "coop-taxi-portoviejo",
  storageBucket: "coop-taxi-portoviejo.firebasestorage.app",
  messagingSenderId: "56802886359",
  appId: "1:56802886359:web:81d14eab7e9d4d9055a692"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

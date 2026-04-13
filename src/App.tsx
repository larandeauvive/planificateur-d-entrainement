import { useState, useEffect } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Lock, Unlock, Loader2, Calendar, Settings2, Activity, Trophy, Flame, Mountain, Dumbbell, Plus, Trash2, Download, Users, UserPlus, History, Clock, Pencil, Check, X, Lightbulb, AlertTriangle, RefreshCw, MessageSquare, Share2, ChevronLeft, ChevronRight } from 'lucide-react';
import { auth, db } from './firebase';
import { onAuthStateChanged, User, signInAnonymously } from 'firebase/auth';
import { collection, doc, setDoc, deleteDoc, onSnapshot, query, where, getDoc, updateDoc, arrayUnion } from 'firebase/firestore';

const getStartOfWeek = (d: Date) => {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
};

const formatDate = (d: Date) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const addDays = (d: Date, days: number) => {
  const date = new Date(d);
  date.setDate(date.getDate() + days);
  return date;
};

const getWeekDays = (start: Date) => Array.from({length: 7}).map((_, i) => formatDate(addDays(start, i)));

const formatDisplayDate = (dateStr: string) => {
  const d = new Date(dateStr);
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
};

let aiClient: GoogleGenAI | null = null;
const getAI = () => {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("Clé API Gemini manquante. Veuillez l'ajouter dans le panneau 'Secrets' (icône clé en haut à droite).");
    }
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
};

interface TrainingSession {
  date: string;
  type: string;
  desc: string;
  locked: boolean;
  userWish?: string;
  support?: string;
  logic?: string;
  coherenceWarning?: string;
  isCompleted?: boolean;
  feedback?: {
    rpe: number;
    comment: string;
  };
}

interface Goal {
  id: string;
  name: string;
  date: string;
  distance: number | '';
  elevation: number | '';
}

interface PastRace {
  id: string;
  name: string;
  date: string;
  distance: number | '';
  elevation: number | '';
  time: string;
}

interface UserProfile {
  id: string;
  linkedUids: string[];
  name: string;
  nbSeances: number;
  mainGoals: Goal[];
  secondaryGoals: Goal[];
  pastRaces: PastRace[];
  isAffutage: boolean;
  plan: TrainingSession[];
}

const generateDefaultPlan = (startDateStr: string): TrainingSession[] => {
  const start = new Date(startDateStr);
  const days = getWeekDays(start);
  const types = ['Repos', 'EF', 'Repos', 'VMA', 'Repos', 'EF', 'Sortie Longue'];
  const descs = ['Récupération', 'Endurance Fondamentale 45min', 'Récupération', 'Échauffement 20min + 10x400m + Retour au calme 10min', 'Récupération', 'Endurance Fondamentale 1h', 'Sortie Longue 1h30'];
  return days.map((date, i) => ({
    date,
    type: types[i],
    desc: descs[i],
    locked: false,
    support: 'Course à pied',
    logic: 'Séance de base.'
  }));
};

const generateShortId = () => Math.random().toString(36).substring(2, 8).toUpperCase();

const defaultProfile = (userId: string): UserProfile => ({
  id: generateShortId(),
  linkedUids: [userId],
  name: 'Mon Profil',
  nbSeances: 4,
  mainGoals: [{ id: '1', name: 'Trail des Crêtes', date: '2026-08-15', distance: 50, elevation: 2000 }],
  secondaryGoals: [{ id: '1', name: 'Semi-marathon de préparation', date: '2026-06-10', distance: 21, elevation: 200 }],
  pastRaces: [],
  isAffutage: false,
  plan: generateDefaultPlan(formatDate(getStartOfWeek(new Date())))
});

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [currentWeekStart, setCurrentWeekStart] = useState<string>(formatDate(getStartOfWeek(new Date())));
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [feedbackDate, setFeedbackDate] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ wish: '', support: 'Course à pied' });
  const [feedbackForm, setFeedbackForm] = useState({ rpe: 5, comment: '' });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setIsAuthReady(true);
      } else {
        try {
          await signInAnonymously(auth);
        } catch (err) {
          console.error("Erreur d'authentification anonyme:", err);
          setError("Impossible de se connecter à l'application.");
        }
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!isAuthReady || !user) {
      setProfiles([]);
      setActiveProfileId('');
      return;
    }

    const q = query(collection(db, 'profiles'), where('linkedUids', 'array-contains', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loadedProfiles = snapshot.docs.map(doc => {
        const data = doc.data() as any;
        // Migration: si le plan contient "jour" au lieu de "date", on le convertit vers la semaine courante
        if (data.plan && data.plan.length > 0 && data.plan[0].jour && !data.plan[0].date) {
          const start = getStartOfWeek(new Date());
          data.plan = data.plan.map((s: any, i: number) => {
            const { jour, ...rest } = s;
            return { ...rest, date: formatDate(addDays(start, i)) };
          });
        }
        return data as UserProfile;
      });
      
      if (loadedProfiles.length === 0) {
        // Create default profile if none exists
        const newProfile = defaultProfile(user.uid);
        setDoc(doc(db, 'profiles', newProfile.id), newProfile);
      } else {
        setProfiles(loadedProfiles);
        if (!activeProfileId || !loadedProfiles.find(p => p.id === activeProfileId)) {
          setActiveProfileId(loadedProfiles[0].id);
        }
      }
    }, (error) => {
      console.error("Firestore Error: ", error);
      setError("Erreur lors du chargement des profils.");
    });

    return () => unsubscribe();
  }, [user, isAuthReady]);

  const handleLinkDevice = async () => {
    if (!user) return;
    const code = prompt("Entrez le code d'accès à 6 caractères d'un autre appareil :");
    if (!code) return;
    
    try {
      const docRef = doc(db, 'profiles', code.toUpperCase());
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        await updateDoc(docRef, {
          linkedUids: arrayUnion(user.uid)
        });
        alert("Appareil lié avec succès !");
      } else {
        alert("Code introuvable.");
      }
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la liaison.");
    }
  };

  const activeProfile = profiles.find(p => p.id === activeProfileId);

  const updateProfile = async (updates: Partial<UserProfile>) => {
    if (!activeProfile || !user) return;
    const updatedProfile = { ...activeProfile, ...updates };
    try {
      await setDoc(doc(db, 'profiles', activeProfile.id), updatedProfile);
    } catch (err) {
      console.error(err);
      setError("Erreur lors de la sauvegarde.");
    }
  };

  const createNewProfile = async () => {
    if (!user) return;
    const newName = prompt('Nom du nouveau profil ?');
    if (newName && newName.trim()) {
      const newProfile: UserProfile = {
        ...defaultProfile(user.uid),
        id: generateShortId(),
        name: newName.trim(),
        mainGoals: [],
        secondaryGoals: [],
        pastRaces: []
      };
      try {
        await setDoc(doc(db, 'profiles', newProfile.id), newProfile);
        setActiveProfileId(newProfile.id);
      } catch (err) {
        console.error(err);
        setError("Erreur lors de la création du profil.");
      }
    }
  };

  const deleteProfile = async (id: string) => {
    if (profiles.length <= 1 || !user) return;
    if (confirm('Voulez-vous vraiment supprimer ce profil ?')) {
      try {
        await deleteDoc(doc(db, 'profiles', id));
        const remaining = profiles.filter(p => p.id !== id);
        if (remaining.length > 0) {
          setActiveProfileId(remaining[0].id);
        }
      } catch (err) {
        console.error(err);
        setError("Erreur lors de la suppression.");
      }
    }
  };

  const renameProfile = () => {
    if (!activeProfile) return;
    const newName = prompt('Nouveau nom du profil ?', activeProfile.name);
    if (newName && newName.trim()) {
      updateProfile({ name: newName.trim() });
    }
  };

  const toggleLock = (date: string) => {
    if (!activeProfile) return;
    const newPlan = [...activeProfile.plan];
    const index = newPlan.findIndex(s => s.date === date);
    if (index >= 0) {
      newPlan[index].locked = !newPlan[index].locked;
      updateProfile({ plan: newPlan });
    }
  };

  const startEdit = (date: string) => {
    if (!activeProfile) return;
    setEditingDate(date);
    const session = activeProfile.plan.find(s => s.date === date);
    setEditForm({
      wish: session?.userWish || '',
      support: session?.support || 'Course à pied'
    });
  };

  const saveEdit = async (date: string) => {
    if (!activeProfile) return;
    const newPlan = [...activeProfile.plan];
    const index = newPlan.findIndex(s => s.date === date);
    if (index >= 0) {
      newPlan[index] = {
        ...newPlan[index],
        userWish: editForm.wish,
        support: editForm.support,
        locked: false // On déverrouille pour que l'IA puisse formater la séance selon le souhait
      };
    } else {
      newPlan.push({
        date,
        type: 'Repos',
        desc: '',
        locked: false,
        userWish: editForm.wish,
        support: editForm.support
      });
    }
    await updateProfile({ plan: newPlan });
    setEditingDate(null);
    
    // On relance la génération pour adapter le reste de la semaine
    await generatePlan(newPlan, currentWeekStart);
  };

  const saveFeedback = async (date: string) => {
    if (!activeProfile) return;
    const newPlan = [...activeProfile.plan];
    const index = newPlan.findIndex(s => s.date === date);
    if (index >= 0) {
      newPlan[index] = {
        ...newPlan[index],
        isCompleted: true,
        feedback: {
          rpe: feedbackForm.rpe,
          comment: feedbackForm.comment
        }
      };
      await updateProfile({ plan: newPlan });
    }
    setFeedbackDate(null);
  };

  const downloadPlan = () => {
    if (!activeProfile) return;
    const weekDates = getWeekDays(new Date(currentWeekStart));
    const weekSessions = weekDates.map(date => activeProfile.plan.find(s => s.date === date) || { date, type: 'Repos', desc: 'Aucune séance prévue.' } as TrainingSession);
    
    const textContent = `Programme d'entraînement - ${activeProfile.name} (Semaine du ${formatDisplayDate(currentWeekStart)})\n\n` +
      weekSessions.map(s => `${formatDisplayDate(s.date)} : ${s.type}\n${s.desc}\n`).join('\n');
    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `planning-${activeProfile.name.replace(/\s+/g, '-').toLowerCase()}-${currentWeekStart}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const generatePlan = async (planToAdapt: TrainingSession[] = activeProfile?.plan || [], targetWeekStart: string = currentWeekStart) => {
    if (!activeProfile) return;
    setLoading(true);
    setError(null);
    try {
      const weekDates = getWeekDays(new Date(targetWeekStart));
      const currentWeekSessions = weekDates.map(date => planToAdapt.find(s => s.date === date) || { date, type: 'Repos', desc: '', locked: false });

      const coursesText = `
Objectifs Majeurs (A) :
${activeProfile.mainGoals.length > 0 ? activeProfile.mainGoals.map(g => `- ${g.name || 'Non défini'} prévu le ${g.date || 'Non défini'} - Distance: ${g.distance || 0}km, Dénivelé: ${g.elevation || 0}m D+`).join('\n') : 'Aucun'}

Objectifs Secondaires (B) :
${activeProfile.secondaryGoals.length > 0 ? activeProfile.secondaryGoals.map(g => `- ${g.name || 'Non défini'} prévu le ${g.date || 'Non défini'} - Distance: ${g.distance || 0}km, Dénivelé: ${g.elevation || 0}m D+`).join('\n') : 'Aucun'}
      `.trim();

      const pastRacesText = activeProfile.pastRaces.length > 0 
        ? activeProfile.pastRaces.map(r => `- ${r.name} (${r.date}) : ${r.distance}km, ${r.elevation}m D+ en ${r.time}`).join('\n')
        : 'Aucun historique renseigné.';

      const prompt = `
### CONFIGURATION SYSTÈME
- ROLE: Coach Expert en Endurance (Route, Trail, Ultra-Trail)

### MISSION
Tu es l'intelligence centrale d'un logiciel de planification. Tu dois générer des entraînements pour les 7 jours de la semaine du ${weekDates[0]} au ${weekDates[6]}.

### EXPERTISE ROUTE & ULTRA-TRAIL
1. ROUTE (5km au Marathon) : Travail de VMA, seuil anaérobie, et allures cibles (AS10, AS21, AS42).
2. TRAIL & ULTRA-TRAIL : 
   - Gestion du dénivelé positif (D+) et négatif (D-).
   - Séances de côtes, rando-course, et week-ends chocs (blocs de 2 jours).
   - Pour les Ultras (> 80km), inclus des conseils sur la nutrition et le matériel dans la description.

### HISTORIQUE DU COUREUR (Niveau et Expérience)
${pastRacesText}

### RETOURS SUR LES SÉANCES PASSÉES (BILAN)
Prends en compte ces retours pour adapter la suite de la semaine (ex: si RPE élevé > 8, allège la suite) :
${planToAdapt.filter(s => s.isCompleted && s.feedback).slice(-10).map(s => `- ${s.date} (${s.type}) : Difficulté ressentie (RPE) = ${s.feedback?.rpe}/10. Commentaire : "${s.feedback?.comment}"`).join('\n') || 'Aucun bilan récent.'}

### LOGIQUE D'ADAPTATION (PARAMÈTRES)
- "nbSeances" : ${activeProfile.nbSeances}
- "courses" : ${coursesText}
- "affutage" : ${activeProfile.isAffutage ? 'Oui (Réduis le volume de 50% la semaine précédant un objectif A)' : 'Non'}
- "locked" : Si une séance dans le planning envoyé est "locked": true, tu ne la modifies JAMAIS. Tu adaptes les autres jours pour garder une charge cohérente.

### CONTRAINTES UTILISATEUR (SOUHAITS ET SUPPORTS)
Dans le planning actuel fourni, certaines journées contiennent un champ "userWish" et/ou "support". 
- Si "userWish" est présent, tu DOIS ABSOLUMENT créer la séance de ce jour en respectant ce souhait (ex: "sortie longue 20km"). 
- Si "support" est différent de "Course à pied" (ex: Vélo, Natation, Renforcement), tu dois adapter le type et la description pour ce sport.
- Tu dois ensuite adapter intelligemment le reste de la semaine autour de ces contraintes.
- Si le souhait de l'utilisateur te semble incohérent ou risqué par rapport à la logique d'entraînement (ex: placer une sortie longue la veille d'une course, ou ne pas respecter de repos après une grosse séance), tu DOIS remplir le champ "coherenceWarning" pour l'avertir, tout en appliquant quand même son souhait.

### PLANNING ACTUEL DE CETTE SEMAINE (à adapter)
${JSON.stringify(currentWeekSessions, null, 2)}

### FORMAT DE SORTIE (STRICT JSON)
Réponds exclusivement par un tableau JSON de 7 éléments (un pour chaque date demandée) :
[
  {
    "date": "YYYY-MM-DD",
    "type": "Repos | EF | VMA | Seuil | Côtes | Sortie Longue | Rando-course | Croisé | Renforcement",
    "support": "Course à pied | Vélo | Natation | Renforcement | Autre",
    "desc": "Description détaillée (Durée, Intensité, D+)",
    "logic": "Explication pédagogique courte : pourquoi cette séance est placée ici dans la semaine ?",
    "coherenceWarning": "Avertissement si le souhait est incohérent (laisser vide si tout va bien)",
    "locked": false
  }
]
      `;

      const ai = getAI();
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                date: { type: Type.STRING },
                type: { type: Type.STRING },
                support: { type: Type.STRING },
                desc: { type: Type.STRING },
                logic: { type: Type.STRING },
                coherenceWarning: { type: Type.STRING },
                locked: { type: Type.BOOLEAN },
              },
              required: ['date', 'type', 'support', 'desc', 'logic', 'locked'],
            },
          },
        },
      });

      if (response.text) {
        const generatedPlan = JSON.parse(response.text);
        
        // Réinjecter les données utilisateur (souhaits, bilans) qui ne doivent pas être perdues
        const newPlan = generatedPlan.map((session: any) => {
          const originalSession = planToAdapt.find(s => s.date === session.date);
          return {
            ...session,
            userWish: originalSession?.userWish || '',
            support: session.support || originalSession?.support || 'Course à pied',
            isCompleted: originalSession?.isCompleted || false,
            feedback: originalSession?.feedback
          };
        });
        
        // Fusionner le nouveau plan de la semaine avec le plan global
        const generatedDates = newPlan.map((s: any) => s.date);
        const filteredPlan = planToAdapt.filter(s => !generatedDates.includes(s.date));
        const finalPlan = [...filteredPlan, ...newPlan];
        
        updateProfile({ plan: finalPlan });
        setActiveTab('dashboard');
      }
    } catch (err: any) {
      setError(err.message || 'Une erreur est survenue lors de la génération.');
    } finally {
      setLoading(false);
    }
  };

  const getTypeColor = (type: string) => {
    const t = type.toLowerCase();
    if (t.includes('repos')) return 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
    if (t.includes('ef')) return 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800';
    if (t.includes('vma') || t.includes('seuil')) return 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800';
    if (t.includes('longue') || t.includes('rando')) return 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800';
    if (t.includes('côte') || t.includes('cote')) return 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800';
    return 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700';
  };

  const weekDates = getWeekDays(new Date(currentWeekStart));
  const weekSessions = weekDates.map(date => activeProfile?.plan.find(s => s.date === date) || { date, type: 'Repos', desc: 'Aucune séance prévue. Cliquez sur Recalculer pour générer cette semaine.', locked: false, support: 'Course à pied' } as TrainingSession);

  const activeSessionsCount = weekSessions.filter(s => !s.type.toLowerCase().includes('repos') && s.desc !== 'Aucune séance prévue. Cliquez sur Recalculer pour générer cette semaine.').length;
  const intenseCount = weekSessions.filter(s => s.type.toLowerCase().match(/vma|seuil|côte|cote/)).length;
  const longCount = weekSessions.filter(s => s.type.toLowerCase().match(/longue|rando/)).length;

  if (error && (!isAuthReady || !activeProfile)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 p-4 text-center space-y-4">
        <div className="p-4 bg-red-100 text-red-700 rounded-full dark:bg-red-900/30 dark:text-red-400">
          <X className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">Une erreur est survenue</h2>
        <p className="text-slate-600 dark:text-slate-400 max-w-md">{error}</p>
        <p className="text-sm text-slate-500 dark:text-slate-500 max-w-md">
          Si vous utilisez Firebase, assurez-vous d'avoir activé le fournisseur de connexion "Anonyme" (Anonymous) dans la console Firebase (Authentication {'>'} Sign-in method).
        </p>
      </div>
    );
  }

  if (!isAuthReady || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!activeProfile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 space-y-4">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <p className="text-slate-500 animate-pulse">Création de votre profil...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 md:p-8 font-sans">
      <div className="max-w-5xl mx-auto space-y-8">
        
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary text-primary-foreground rounded-xl shadow-sm">
              <Activity className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Coach Endurance IA</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">Planificateur Route, Trail & Ultra-Trail</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2 bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm">
              <Users className="w-4 h-4 text-slate-500 ml-2" />
              <select
                className="bg-transparent border-none focus:ring-0 text-sm font-medium cursor-pointer outline-none"
                value={activeProfileId}
                onChange={(e) => setActiveProfileId(e.target.value)}
              >
                {profiles.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-1"></div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={renameProfile} title="Renommer le profil">
                <Settings2 className="w-4 h-4 text-slate-500" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={createNewProfile} title="Nouveau profil">
                <UserPlus className="w-4 h-4 text-slate-500" />
              </Button>
              {profiles.length > 1 && (
                <Button variant="ghost" size="icon" className="h-8 w-8 hover:text-red-500" onClick={() => deleteProfile(activeProfileId)} title="Supprimer le profil">
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
            
            <div className="flex items-center gap-2">
              {activeProfile && (
                <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700">
                  <span className="text-xs text-slate-500">Code d'accès :</span>
                  <code className="font-mono font-bold text-slate-900 dark:text-white select-all">{activeProfile.id}</code>
                </div>
              )}
              <Button variant="outline" size="sm" onClick={handleLinkDevice} className="text-blue-600 border-blue-200 hover:bg-blue-50 dark:border-blue-900 dark:hover:bg-blue-900/30">
                <Share2 className="w-4 h-4 mr-2" />
                Lier un appareil
              </Button>
            </div>
          </div>
        </header>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full max-w-2xl grid-cols-3">
            <TabsTrigger value="dashboard" className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              <span className="hidden sm:inline">Dashboard</span>
            </TabsTrigger>
            <TabsTrigger value="parameters" className="flex items-center gap-2">
              <Settings2 className="w-4 h-4" />
              <span className="hidden sm:inline">Objectifs</span>
            </TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-2">
              <History className="w-4 h-4" />
              <span className="hidden sm:inline">Historique</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="space-y-6 animate-in fade-in-50 duration-500">
            {/* Stats Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
                <CardContent className="p-6 flex items-center gap-4">
                  <div className="p-3 bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 rounded-full">
                    <Dumbbell className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Séances actives</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white">{activeSessionsCount} <span className="text-sm font-normal text-slate-500">/ 7 jours</span></p>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
                <CardContent className="p-6 flex items-center gap-4">
                  <div className="p-3 bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 rounded-full">
                    <Flame className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Séances intenses</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white">{intenseCount} <span className="text-sm font-normal text-slate-500">séance(s)</span></p>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
                <CardContent className="p-6 flex items-center gap-4">
                  <div className="p-3 bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400 rounded-full">
                    <Mountain className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Sorties longues</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white">{longCount} <span className="text-sm font-normal text-slate-500">séance(s)</span></p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Weekly Plan */}
            <div className="flex items-center justify-between bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm mb-4">
              <Button variant="ghost" size="sm" onClick={() => setCurrentWeekStart(formatDate(addDays(new Date(currentWeekStart), -7)))}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Précédent
              </Button>
              <span className="font-semibold text-slate-700 dark:text-slate-200 capitalize">
                Semaine du {new Date(currentWeekStart).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setCurrentWeekStart(formatDate(addDays(new Date(currentWeekStart), 7)))}>
                Suivant <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>

            <Card className="border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
              <CardHeader className="bg-slate-50/50 dark:bg-slate-900/20 border-b border-slate-100 dark:border-slate-800/50 pb-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <CardTitle className="text-lg">Programme de la semaine</CardTitle>
                    <CardDescription>Plan personnalisé pour {activeProfile.name}.</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="default" size="sm" onClick={() => generatePlan(activeProfile.plan, currentWeekStart)} disabled={loading} className="bg-blue-600 hover:bg-blue-700 text-white">
                      {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                      Recalculer
                    </Button>
                    <Button variant="outline" size="sm" onClick={downloadPlan}>
                      <Download className="w-4 h-4 mr-2" />
                      Télécharger
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setActiveTab('parameters')} className="hidden sm:flex">
                      <Settings2 className="w-4 h-4 mr-2" />
                      Modifier
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
                  {weekSessions.map((session, index) => (
                    <div 
                      key={session.date} 
                      className={`p-4 sm:p-5 flex flex-col sm:flex-row gap-4 transition-colors hover:bg-slate-50/50 dark:hover:bg-slate-900/50 ${session.locked ? 'bg-slate-50 dark:bg-slate-900/20' : ''}`}
                    >
                      {/* Day & Lock */}
                      <div className="sm:w-32 flex items-center sm:items-start justify-between sm:flex-col gap-2 shrink-0">
                        <span className="font-bold text-slate-700 dark:text-slate-200 capitalize">{formatDisplayDate(session.date)}</span>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className={`h-8 px-2 text-xs ${session.locked ? 'text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:text-amber-500 dark:hover:bg-amber-950/50' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                          onClick={() => toggleLock(session.date)}
                        >
                          {session.locked ? (
                            <><Lock className="w-3 h-3 mr-1" /> Verrouillé</>
                          ) : (
                            <><Unlock className="w-3 h-3 mr-1" /> Libre</>
                          )}
                        </Button>
                      </div>

                      {/* Content */}
                      {editingDate === session.date ? (
                        <div className="flex-1 space-y-4 bg-white dark:bg-slate-950 p-4 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm">
                          <div className="space-y-2">
                            <Label className="text-xs text-slate-500 font-semibold">Type de support :</Label>
                            <select 
                              className="w-full text-sm border border-slate-200 rounded-md p-2 dark:bg-slate-900 dark:border-slate-800"
                              value={editForm.support}
                              onChange={e => setEditForm({ ...editForm, support: e.target.value })}
                            >
                              <option value="Course à pied">Course à pied</option>
                              <option value="Vélo">Vélo / Cyclisme</option>
                              <option value="Natation">Natation</option>
                              <option value="Renforcement">Renforcement musculaire</option>
                              <option value="Autre">Autre (préciser dans le souhait)</option>
                            </select>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs text-slate-500 font-semibold">Votre souhait pour le {formatDisplayDate(session.date)} :</Label>
                            <Textarea 
                              value={editForm.wish} 
                              onChange={e => setEditForm({ ...editForm, wish: e.target.value })} 
                              placeholder="Ex: Je veux faire une sortie longue de 20km, ou Repos forcé..."
                              rows={2}
                              className="text-sm resize-none"
                            />
                          </div>
                          <div className="flex gap-2 justify-end pt-2">
                            <Button variant="ghost" size="sm" onClick={() => setEditingDate(null)} className="h-8 text-xs">
                              <X className="w-3 h-3 mr-1" /> Annuler
                            </Button>
                            <Button variant="default" size="sm" onClick={() => saveEdit(session.date)} className="h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white">
                              <Check className="w-3 h-3 mr-1" /> Adapter la semaine
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="outline" className={`font-medium border ${getTypeColor(session.type)}`}>
                                {session.type}
                              </Badge>
                              {session.support && session.support !== 'Course à pied' && (
                                <Badge variant="secondary" className="bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-900/30 dark:text-teal-400 dark:border-teal-800 text-xs">
                                  {session.support}
                                </Badge>
                              )}
                              {session.userWish && (
                                <Badge variant="secondary" className="bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-800 text-xs">
                                  Souhait: {session.userWish}
                                </Badge>
                              )}
                            </div>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400" onClick={() => startEdit(session.date)} title="Émettre un souhait pour ce jour">
                              <Pencil className="w-4 h-4" />
                            </Button>
                          </div>
                          <p className="text-slate-600 dark:text-slate-300 text-sm leading-relaxed">
                            {session.desc}
                          </p>
                          {session.logic && (
                            <div className="mt-3 p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-100 dark:border-slate-800">
                              <p className="text-sm text-slate-600 dark:text-slate-400 flex items-start gap-2">
                                <Lightbulb className="w-4 h-4 shrink-0 text-amber-500 mt-0.5" />
                                <span>{session.logic}</span>
                              </p>
                            </div>
                          )}
                          {session.coherenceWarning && (
                            <div className="mt-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-100 dark:border-red-800/50">
                              <p className="text-sm text-red-700 dark:text-red-400 flex items-start gap-2">
                                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                                <span><strong>Attention :</strong> {session.coherenceWarning}</span>
                              </p>
                            </div>
                          )}
                          
                          {/* Feedback / Bilan Section */}
                          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/50">
                            {session.isCompleted && session.feedback ? (
                              <div className="bg-slate-50 dark:bg-slate-900/30 p-3 rounded-lg border border-slate-100 dark:border-slate-800">
                                <div className="flex items-center gap-2 mb-1">
                                  <Check className="w-4 h-4 text-green-500" />
                                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Séance terminée</span>
                                  <Badge variant="outline" className="ml-auto text-xs">RPE: {session.feedback.rpe}/10</Badge>
                                </div>
                                {session.feedback.comment && (
                                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 italic">"{session.feedback.comment}"</p>
                                )}
                              </div>
                            ) : feedbackDate === session.date ? (
                              <div className="bg-white dark:bg-slate-950 p-3 rounded-lg border border-blue-200 dark:border-blue-900/50 shadow-sm space-y-3">
                                <div>
                                  <Label className="text-xs text-slate-500 font-semibold mb-1 block">Difficulté ressentie (RPE 1-10) :</Label>
                                  <div className="flex items-center gap-3">
                                    <input 
                                      type="range" 
                                      min="1" max="10" 
                                      value={feedbackForm.rpe} 
                                      onChange={e => setFeedbackForm({...feedbackForm, rpe: parseInt(e.target.value)})}
                                      className="flex-1"
                                    />
                                    <span className="text-sm font-bold w-6 text-center">{feedbackForm.rpe}</span>
                                  </div>
                                </div>
                                <div>
                                  <Label className="text-xs text-slate-500 font-semibold mb-1 block">Commentaire (fatigue, sensations...) :</Label>
                                  <Textarea 
                                    value={feedbackForm.comment}
                                    onChange={e => setFeedbackForm({...feedbackForm, comment: e.target.value})}
                                    placeholder="Ex: Super sensations, ou Très fatigué sur la fin..."
                                    rows={2}
                                    className="text-sm resize-none"
                                  />
                                </div>
                                <div className="flex gap-2 justify-end">
                                  <Button variant="ghost" size="sm" onClick={() => setFeedbackDate(null)} className="h-8 text-xs">
                                    Annuler
                                  </Button>
                                  <Button variant="default" size="sm" onClick={() => saveFeedback(session.date)} className="h-8 text-xs bg-green-600 hover:bg-green-700 text-white">
                                    <Check className="w-3 h-3 mr-1" /> Valider le bilan
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <Button variant="ghost" size="sm" onClick={() => { setFeedbackDate(session.date); setFeedbackForm({ rpe: 5, comment: '' }); }} className="text-xs text-slate-500 hover:text-blue-600">
                                <MessageSquare className="w-3 h-3 mr-1" /> Faire le bilan de la séance
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="parameters" className="animate-in fade-in-50 duration-500">
            <Card className="border-slate-200 dark:border-slate-800 shadow-sm max-w-3xl mx-auto">
              <CardHeader>
                <CardTitle className="text-xl">Objectifs & Configuration</CardTitle>
                <CardDescription>Ajustez les objectifs pour {activeProfile.name}.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-8">
                
                <div className="space-y-4">
                  <Label htmlFor="nbSeances" className="text-base font-semibold">Volume hebdomadaire</Label>
                  <div className="flex items-center gap-4">
                    <Input 
                      id="nbSeances" 
                      type="number" 
                      min={1} 
                      max={7} 
                      value={activeProfile.nbSeances} 
                      onChange={(e) => updateProfile({ nbSeances: parseInt(e.target.value) || 0 })}
                      className="w-24 text-lg"
                    />
                    <span className="text-slate-500">séances par semaine</span>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <Label className="text-base font-semibold flex items-center gap-2">
                      <Trophy className="w-5 h-5 text-amber-500" />
                      Objectifs Majeurs (A)
                    </Label>
                    <Button variant="outline" size="sm" onClick={() => updateProfile({ mainGoals: [...activeProfile.mainGoals, { id: Date.now().toString(), name: '', date: '', distance: '', elevation: '' }] })}>
                      <Plus className="w-4 h-4 mr-2" /> Ajouter
                    </Button>
                  </div>
                  
                  <div className="space-y-4">
                    {activeProfile.mainGoals.map((goal, index) => (
                      <div key={goal.id} className="space-y-4 p-5 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-100 dark:border-slate-800 relative">
                        <div className="flex items-center justify-between">
                          <h3 className="font-semibold text-amber-600 dark:text-amber-500 flex items-center gap-2">
                            Objectif Majeur #{index + 1}
                          </h3>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-500" onClick={() => updateProfile({ mainGoals: activeProfile.mainGoals.filter(g => g.id !== goal.id) })}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                        <div className="space-y-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs text-slate-500 uppercase tracking-wider">Nom de l'évènement</Label>
                            <Input 
                              value={goal.name} 
                              onChange={e => updateProfile({ mainGoals: activeProfile.mainGoals.map(g => g.id === goal.id ? { ...g, name: e.target.value } : g) })} 
                              placeholder="Ex: UTMB, Marathon de Paris..." 
                            />
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div className="space-y-1.5">
                              <Label className="text-xs text-slate-500 uppercase tracking-wider">Date</Label>
                              <Input 
                                type="date" 
                                value={goal.date} 
                                onChange={e => updateProfile({ mainGoals: activeProfile.mainGoals.map(g => g.id === goal.id ? { ...g, date: e.target.value } : g) })} 
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs text-slate-500 uppercase tracking-wider">Distance (km)</Label>
                              <Input 
                                type="number" 
                                min={0}
                                value={goal.distance} 
                                onChange={e => updateProfile({ mainGoals: activeProfile.mainGoals.map(g => g.id === goal.id ? { ...g, distance: e.target.value ? Number(e.target.value) : '' } : g) })} 
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs text-slate-500 uppercase tracking-wider">Dénivelé (m D+)</Label>
                              <Input 
                                type="number" 
                                min={0}
                                value={goal.elevation} 
                                onChange={e => updateProfile({ mainGoals: activeProfile.mainGoals.map(g => g.id === goal.id ? { ...g, elevation: e.target.value ? Number(e.target.value) : '' } : g) })} 
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    {activeProfile.mainGoals.length === 0 && (
                      <p className="text-sm text-slate-500 italic text-center py-4">Aucun objectif majeur défini.</p>
                    )}
                  </div>
                </div>

                <div className="space-y-6 pt-4 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center justify-between">
                    <Label className="text-base font-semibold flex items-center gap-2">
                      <Mountain className="w-5 h-5 text-slate-500" />
                      Objectifs Secondaires (B)
                    </Label>
                    <Button variant="outline" size="sm" onClick={() => updateProfile({ secondaryGoals: [...activeProfile.secondaryGoals, { id: Date.now().toString(), name: '', date: '', distance: '', elevation: '' }] })}>
                      <Plus className="w-4 h-4 mr-2" /> Ajouter
                    </Button>
                  </div>
                  
                  <div className="space-y-4">
                    {activeProfile.secondaryGoals.map((goal, index) => (
                      <div key={goal.id} className="space-y-4 p-5 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-100 dark:border-slate-800 relative">
                        <div className="flex items-center justify-between">
                          <h3 className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                            Objectif Secondaire #{index + 1}
                          </h3>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-500" onClick={() => updateProfile({ secondaryGoals: activeProfile.secondaryGoals.filter(g => g.id !== goal.id) })}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                        <div className="space-y-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs text-slate-500 uppercase tracking-wider">Nom de l'évènement</Label>
                            <Input 
                              value={goal.name} 
                              onChange={e => updateProfile({ secondaryGoals: activeProfile.secondaryGoals.map(g => g.id === goal.id ? { ...g, name: e.target.value } : g) })} 
                              placeholder="Ex: Semi-marathon..." 
                            />
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div className="space-y-1.5">
                              <Label className="text-xs text-slate-500 uppercase tracking-wider">Date</Label>
                              <Input 
                                type="date" 
                                value={goal.date} 
                                onChange={e => updateProfile({ secondaryGoals: activeProfile.secondaryGoals.map(g => g.id === goal.id ? { ...g, date: e.target.value } : g) })} 
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs text-slate-500 uppercase tracking-wider">Distance (km)</Label>
                              <Input 
                                type="number" 
                                min={0}
                                value={goal.distance} 
                                onChange={e => updateProfile({ secondaryGoals: activeProfile.secondaryGoals.map(g => g.id === goal.id ? { ...g, distance: e.target.value ? Number(e.target.value) : '' } : g) })} 
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs text-slate-500 uppercase tracking-wider">Dénivelé (m D+)</Label>
                              <Input 
                                type="number" 
                                min={0}
                                value={goal.elevation} 
                                onChange={e => updateProfile({ secondaryGoals: activeProfile.secondaryGoals.map(g => g.id === goal.id ? { ...g, elevation: e.target.value ? Number(e.target.value) : '' } : g) })} 
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    {activeProfile.secondaryGoals.length === 0 && (
                      <p className="text-sm text-slate-500 italic text-center py-4">Aucun objectif secondaire défini.</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 bg-slate-100 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                  <div className="space-y-1">
                    <Label htmlFor="affutage" className="text-base font-semibold">Semaine d'affûtage</Label>
                    <p className="text-sm text-slate-500">Réduit le volume de 50% avant une course</p>
                  </div>
                  <Switch 
                    id="affutage" 
                    checked={activeProfile.isAffutage}
                    onCheckedChange={(checked) => updateProfile({ isAffutage: checked })}
                  />
                </div>

                <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
                  <Button 
                    className="w-full text-base h-12" 
                    size="lg"
                    onClick={generatePlan}
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Génération en cours...
                      </>
                    ) : (
                      'Générer le nouveau planning'
                    )}
                  </Button>
                  
                  {error && (
                    <div className="mt-4 p-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">
                      {error}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="animate-in fade-in-50 duration-500">
            <Card className="border-slate-200 dark:border-slate-800 shadow-sm max-w-3xl mx-auto">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-xl">Historique des courses</CardTitle>
                    <CardDescription>Enregistrez vos temps passés pour aider l'IA à évaluer votre niveau.</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => updateProfile({ pastRaces: [{ id: Date.now().toString(), name: '', date: '', distance: '', elevation: '', time: '' }, ...activeProfile.pastRaces] })}>
                    <Plus className="w-4 h-4 mr-2" /> Ajouter
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {activeProfile.pastRaces.map((race) => (
                  <div key={race.id} className="p-5 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-100 dark:border-slate-800 relative">
                    <Button variant="ghost" size="icon" className="absolute top-3 right-3 h-8 w-8 text-slate-400 hover:text-red-500" onClick={() => updateProfile({ pastRaces: activeProfile.pastRaces.filter(r => r.id !== race.id) })}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                    <div className="space-y-4 pr-8">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-slate-500 uppercase tracking-wider">Nom de la course</Label>
                          <Input 
                            value={race.name} 
                            onChange={e => updateProfile({ pastRaces: activeProfile.pastRaces.map(r => r.id === race.id ? { ...r, name: e.target.value } : r) })} 
                            placeholder="Ex: SaintéLyon" 
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-slate-500 uppercase tracking-wider">Date</Label>
                          <Input 
                            type="date" 
                            value={race.date} 
                            onChange={e => updateProfile({ pastRaces: activeProfile.pastRaces.map(r => r.id === race.id ? { ...r, date: e.target.value } : r) })} 
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-slate-500 uppercase tracking-wider">Distance (km)</Label>
                          <Input 
                            type="number" 
                            min={0}
                            value={race.distance} 
                            onChange={e => updateProfile({ pastRaces: activeProfile.pastRaces.map(r => r.id === race.id ? { ...r, distance: e.target.value ? Number(e.target.value) : '' } : r) })} 
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-slate-500 uppercase tracking-wider">Dénivelé (m D+)</Label>
                          <Input 
                            type="number" 
                            min={0}
                            value={race.elevation} 
                            onChange={e => updateProfile({ pastRaces: activeProfile.pastRaces.map(r => r.id === race.id ? { ...r, elevation: e.target.value ? Number(e.target.value) : '' } : r) })} 
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-slate-500 uppercase tracking-wider flex items-center gap-1">
                            <Clock className="w-3 h-3" /> Temps
                          </Label>
                          <Input 
                            placeholder="Ex: 04:30:00"
                            value={race.time} 
                            onChange={e => updateProfile({ pastRaces: activeProfile.pastRaces.map(r => r.id === race.id ? { ...r, time: e.target.value } : r) })} 
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {activeProfile.pastRaces.length === 0 && (
                  <div className="text-center py-12 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                    <History className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                    <p className="text-slate-500 font-medium">Aucune course enregistrée</p>
                    <p className="text-sm text-slate-400 mt-1">Ajoutez vos résultats passés pour personnaliser le coaching.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

      </div>
    </div>
  );
}

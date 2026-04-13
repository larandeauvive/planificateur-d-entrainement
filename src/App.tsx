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
import { Lock, Unlock, Loader2, Calendar, Settings2, Activity, Trophy, Flame, Mountain, Dumbbell, Plus, Trash2, Download, Users, UserPlus, History, Clock, Pencil, Check, X, LogIn, LogOut, Lightbulb, AlertTriangle } from 'lucide-react';
import { auth, db, googleProvider } from './firebase';
import { onAuthStateChanged, User, signInAnonymously, linkWithPopup, signInWithPopup, signOut } from 'firebase/auth';
import { collection, doc, setDoc, deleteDoc, onSnapshot, query, where } from 'firebase/firestore';

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
  jour: string;
  type: string;
  desc: string;
  locked: boolean;
  userWish?: string;
  support?: string;
  logic?: string;
  coherenceWarning?: string;
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
  userId: string;
  name: string;
  nbSeances: number;
  mainGoals: Goal[];
  secondaryGoals: Goal[];
  pastRaces: PastRace[];
  isAffutage: boolean;
  plan: TrainingSession[];
}

const defaultPlan: TrainingSession[] = [
  { jour: 'Lundi', type: 'Repos', desc: 'Récupération', locked: false, support: 'Course à pied', logic: 'Le repos est essentiel après la sortie longue du dimanche pour assimiler le travail.' },
  { jour: 'Mardi', type: 'EF', desc: 'Endurance Fondamentale 45min', locked: false, support: 'Course à pied', logic: 'Reprise en douceur pour faire circuler le sang et travailler la base aérobie.' },
  { jour: 'Mercredi', type: 'Repos', desc: 'Récupération', locked: false, support: 'Course à pied', logic: 'Repos avant la grosse séance d\'intensité de la semaine.' },
  { jour: 'Jeudi', type: 'VMA', desc: 'Échauffement 20min + 10x400m + Retour au calme 10min', locked: false, support: 'Course à pied', logic: 'Développement de la Vitesse Maximale Aérobie pour progresser en vitesse.' },
  { jour: 'Vendredi', type: 'Repos', desc: 'Récupération', locked: false, support: 'Course à pied', logic: 'Assimilation de la séance de VMA.' },
  { jour: 'Samedi', type: 'EF', desc: 'Endurance Fondamentale 1h', locked: false, support: 'Course à pied', logic: 'Pré-fatigue en douceur avant la sortie longue du lendemain.' },
  { jour: 'Dimanche', type: 'Sortie Longue', desc: 'Sortie Longue 1h30', locked: false, support: 'Course à pied', logic: 'Travail de l\'endurance spécifique et de la résistance musculaire.' },
];

const defaultProfile = (userId: string): UserProfile => ({
  id: Date.now().toString(),
  userId,
  name: 'Mon Profil',
  nbSeances: 4,
  mainGoals: [{ id: '1', name: 'Trail des Crêtes', date: '2026-08-15', distance: 50, elevation: 2000 }],
  secondaryGoals: [{ id: '1', name: 'Semi-marathon de préparation', date: '2026-06-10', distance: 21, elevation: 200 }],
  pastRaces: [],
  isAffutage: false,
  plan: defaultPlan
});

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ wish: '', support: 'Course à pied' });

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

    const q = query(collection(db, 'profiles'), where('userId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loadedProfiles = snapshot.docs.map(doc => doc.data() as UserProfile);
      
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

  const handleLinkAccount = async () => {
    if (!user) return;
    try {
      await linkWithPopup(user, googleProvider);
      alert("Compte sauvegardé avec succès ! Vous pouvez maintenant vous connecter avec ce compte Google sur vos autres appareils pour retrouver vos données.");
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/credential-already-in-use') {
        alert("Ce compte Google est déjà lié à un autre profil. Veuillez utiliser un autre compte Google, ou connectez-vous directement si vous souhaitez écraser les données actuelles.");
      } else {
        alert("Erreur lors de la sauvegarde du compte.");
      }
    }
  };

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la connexion.");
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      // Après la déconnexion, onAuthStateChanged va recréer un compte anonyme automatiquement
    } catch (err) {
      console.error(err);
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
        id: Date.now().toString(),
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

  const toggleLock = (index: number) => {
    if (!activeProfile) return;
    const newPlan = [...activeProfile.plan];
    newPlan[index].locked = !newPlan[index].locked;
    updateProfile({ plan: newPlan });
  };

  const startEdit = (index: number) => {
    if (!activeProfile) return;
    setEditingIndex(index);
    setEditForm({
      wish: activeProfile.plan[index].userWish || '',
      support: activeProfile.plan[index].support || 'Course à pied'
    });
  };

  const saveEdit = async (index: number) => {
    if (!activeProfile) return;
    const newPlan = [...activeProfile.plan];
    newPlan[index] = {
      ...newPlan[index],
      userWish: editForm.wish,
      support: editForm.support,
      locked: false // On déverrouille pour que l'IA puisse formater la séance selon le souhait
    };
    await updateProfile({ plan: newPlan });
    setEditingIndex(null);
    
    // On relance la génération pour adapter le reste de la semaine
    await generatePlan(newPlan);
  };

  const downloadPlan = () => {
    if (!activeProfile) return;
    const textContent = `Programme d'entraînement - ${activeProfile.name}\n\n` +
      activeProfile.plan.map(s => `${s.jour} : ${s.type}\n${s.desc}\n`).join('\n');
    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `planning-${activeProfile.name.replace(/\s+/g, '-').toLowerCase()}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const generatePlan = async (planToAdapt: TrainingSession[] = activeProfile?.plan || []) => {
    if (!activeProfile) return;
    setLoading(true);
    setError(null);
    try {
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
Tu es l'intelligence centrale d'un logiciel de planification. Tu dois générer des entraînements hebdomadaires basés sur les objectifs et l'historique du coureur.

### EXPERTISE ROUTE & ULTRA-TRAIL
1. ROUTE (5km au Marathon) : Travail de VMA, seuil anaérobie, et allures cibles (AS10, AS21, AS42).
2. TRAIL & ULTRA-TRAIL : 
   - Gestion du dénivelé positif (D+) et négatif (D-).
   - Séances de côtes, rando-course, et week-ends chocs (blocs de 2 jours).
   - Pour les Ultras (> 80km), inclus des conseils sur la nutrition et le matériel dans la description.

### HISTORIQUE DU COUREUR (Niveau et Expérience)
${pastRacesText}

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

### PLANNING ACTUEL (à adapter)
${JSON.stringify(planToAdapt, null, 2)}

### FORMAT DE SORTIE (STRICT JSON)
Réponds exclusivement par un tableau JSON, sans texte superflu :
[
  {
    "jour": "Lundi",
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
                jour: { type: Type.STRING },
                type: { type: Type.STRING },
                support: { type: Type.STRING },
                desc: { type: Type.STRING },
                logic: { type: Type.STRING },
                coherenceWarning: { type: Type.STRING },
                locked: { type: Type.BOOLEAN },
              },
              required: ['jour', 'type', 'support', 'desc', 'logic', 'locked'],
            },
          },
        },
      });

      if (response.text) {
        const generatedPlan = JSON.parse(response.text);
        // On réinjecte les souhaits (userWish) pour ne pas les perdre lors des prochaines générations
        const newPlan = generatedPlan.map((session: any) => {
          const originalSession = planToAdapt.find(s => s.jour === session.jour);
          return {
            ...session,
            userWish: originalSession?.userWish || '',
            support: session.support || originalSession?.support || 'Course à pied'
          };
        });
        updateProfile({ plan: newPlan });
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

  const activeSessionsCount = activeProfile?.plan.filter(s => !s.type.toLowerCase().includes('repos')).length || 0;
  const intenseCount = activeProfile?.plan.filter(s => s.type.toLowerCase().match(/vma|seuil|côte|cote/)).length || 0;
  const longCount = activeProfile?.plan.filter(s => s.type.toLowerCase().match(/longue|rando/)).length || 0;

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
              {user?.isAnonymous ? (
                <>
                  <Button variant="outline" size="sm" onClick={handleLinkAccount} className="text-blue-600 border-blue-200 hover:bg-blue-50 dark:border-blue-900 dark:hover:bg-blue-900/30">
                    <LogIn className="w-4 h-4 mr-2" />
                    Sauvegarder (Google)
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleLogin} className="text-slate-500 hover:text-slate-700">
                    Déjà un compte ?
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" onClick={handleLogout} className="text-slate-500 hover:text-slate-700">
                  <LogOut className="w-4 h-4 mr-2" />
                  Déconnexion
                </Button>
              )}
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
            <Card className="border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
              <CardHeader className="bg-slate-50/50 dark:bg-slate-900/20 border-b border-slate-100 dark:border-slate-800/50 pb-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <CardTitle className="text-lg">Programme de la semaine</CardTitle>
                    <CardDescription>Plan personnalisé pour {activeProfile.name}.</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
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
                  {activeProfile.plan.map((session, index) => (
                    <div 
                      key={index} 
                      className={`p-4 sm:p-5 flex flex-col sm:flex-row gap-4 transition-colors hover:bg-slate-50/50 dark:hover:bg-slate-900/50 ${session.locked ? 'bg-slate-50 dark:bg-slate-900/20' : ''}`}
                    >
                      {/* Day & Lock */}
                      <div className="sm:w-32 flex items-center sm:items-start justify-between sm:flex-col gap-2 shrink-0">
                        <span className="font-bold text-slate-700 dark:text-slate-200">{session.jour}</span>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className={`h-8 px-2 text-xs ${session.locked ? 'text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:text-amber-500 dark:hover:bg-amber-950/50' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                          onClick={() => toggleLock(index)}
                        >
                          {session.locked ? (
                            <><Lock className="w-3 h-3 mr-1" /> Verrouillé</>
                          ) : (
                            <><Unlock className="w-3 h-3 mr-1" /> Libre</>
                          )}
                        </Button>
                      </div>

                      {/* Content */}
                      {editingIndex === index ? (
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
                            <Label className="text-xs text-slate-500 font-semibold">Votre souhait pour {session.jour} :</Label>
                            <Textarea 
                              value={editForm.wish} 
                              onChange={e => setEditForm({ ...editForm, wish: e.target.value })} 
                              placeholder="Ex: Je veux faire une sortie longue de 20km, ou Repos forcé..."
                              rows={2}
                              className="text-sm resize-none"
                            />
                          </div>
                          <div className="flex gap-2 justify-end pt-2">
                            <Button variant="ghost" size="sm" onClick={() => setEditingIndex(null)} className="h-8 text-xs">
                              <X className="w-3 h-3 mr-1" /> Annuler
                            </Button>
                            <Button variant="default" size="sm" onClick={() => saveEdit(index)} className="h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white">
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
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400" onClick={() => startEdit(index)} title="Émettre un souhait pour ce jour">
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

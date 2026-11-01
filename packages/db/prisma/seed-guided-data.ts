// FitFusion AI — Yoga & Aerobics guided catalog seed data (V22 Phase A).
// All copy is original. No medical or rehabilitation claims anywhere:
// poses and routines are described as general fitness/wellbeing activities,
// every pose carries beginner modifications and, where relevant, cautions.
// Media is intentionally absent here — rows are created with the schema
// defaults (mediaType "none", mediaStatus "placeholder") until a real,
// verified demonstration asset exists.

export interface YogaPoseSeed {
  slug: string;
  name: string;
  sanskritName: string;
  description: string;
  instructions: string[];
  breathing: string;
  modifications: string;
  cautions?: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  defaultHoldSeconds: number;
  bilateral: boolean;
  focusAreas: string[];
}

export interface YogaSequencePoseSeed {
  poseSlug: string;
  holdSeconds: number;
  /** both | left | right | each — defaults to "both". */
  side?: 'both' | 'left' | 'right' | 'each';
  transitionSeconds?: number;
  cue?: string;
}

export interface YogaSequenceSeed {
  slug: string;
  title: string;
  category: string;
  level: string;
  description: string;
  safetyNotes: string;
  metValue: number;
  poses: YogaSequencePoseSeed[];
}

export interface RoutineStepSeed {
  phase: 'warmup' | 'main' | 'cooldown';
  name: string;
  durationSeconds: number;
  cue?: string;
  lowImpactAlternative?: string;
}

export interface AerobicRoutineSeed {
  slug: string;
  title: string;
  category: string;
  level: string;
  intensity: string;
  metValue: number;
  description: string;
  safetyNotes: string;
  steps: RoutineStepSeed[];
}

export const YOGA_POSES: YogaPoseSeed[] = [
  {
    slug: 'mountain-pose',
    name: 'Mountain Pose',
    sanskritName: 'Tadasana',
    description:
      'A foundational standing pose that builds awareness of alignment and steady, balanced posture.',
    instructions: [
      'Stand with feet together or hip-width apart, weight even across both feet.',
      'Press down through the corners of the feet and lift the kneecaps by engaging the thighs.',
      'Lengthen the tailbone down and lift the crown of the head toward the ceiling.',
      'Let the arms rest alongside the body, palms facing forward.',
      'Soften the shoulders away from the ears and breathe steadily.',
    ],
    breathing: 'Breathe slowly and evenly through the nose, lengthening the exhale.',
    modifications: 'Stand with feet hip-width apart for a wider, steadier base, or stand near a wall for support.',
    difficulty: 'beginner',
    defaultHoldSeconds: 30,
    bilateral: false,
    focusAreas: ['posture', 'legs', 'balance'],
  },
  {
    slug: 'easy-pose',
    name: 'Easy Pose',
    sanskritName: 'Sukhasana',
    description:
      'A comfortable cross-legged seat used for grounding, breath awareness and quiet focus at the start or end of practice.',
    instructions: [
      'Sit on the floor or on a folded blanket with legs crossed comfortably.',
      'Rest the hands on the knees or in the lap, palms up or down.',
      'Sit tall through the spine, lifting the crown of the head.',
      'Relax the shoulders and soften the facial muscles.',
      'Close the eyes if comfortable and follow the natural breath.',
    ],
    breathing: 'Natural, unforced breathing; gradually slow the breath without strain.',
    modifications: 'Sit on a cushion or folded blanket to raise the hips above the knees, or sit on a chair with feet flat on the floor.',
    difficulty: 'beginner',
    defaultHoldSeconds: 60,
    bilateral: false,
    focusAreas: ['hips', 'back', 'relaxation'],
  },
  {
    slug: 'cat-cow',
    name: 'Cat-Cow',
    sanskritName: 'Marjaryasana-Bitilasana',
    description:
      'A gentle flowing movement between two positions that warms up the spine and coordinates movement with breath.',
    instructions: [
      'Start on hands and knees, wrists under shoulders and knees under hips.',
      'On an inhale, let the belly soften toward the floor and lift the chest and tailbone (cow).',
      'On an exhale, round the spine toward the ceiling and tuck the chin slightly (cat).',
      'Move slowly between the two shapes, following the breath.',
      'Keep the elbows soft and the neck in line with the spine.',
    ],
    breathing: 'Inhale into cow, exhale into cat — one full breath per movement.',
    modifications: 'Place a folded blanket under the knees, or practise seated on a chair moving the spine the same way.',
    cautions: 'Move within a comfortable range and avoid forcing the neck or lower back into deep bends.',
    difficulty: 'beginner',
    defaultHoldSeconds: 45,
    bilateral: false,
    focusAreas: ['spine', 'core', 'mobility'],
  },
  {
    slug: 'downward-facing-dog',
    name: 'Downward-Facing Dog',
    sanskritName: 'Adho Mukha Svanasana',
    description:
      'An energising inverted V-shape that stretches the back of the body while building shoulder and arm steadiness.',
    instructions: [
      'From hands and knees, tuck the toes and lift the hips up and back.',
      'Press the floor away with the hands, fingers spread wide.',
      'Reach the hips toward the ceiling and let the heels descend toward the floor.',
      'Keep the head between the upper arms and the spine long.',
      'Pedal the feet gently if the backs of the legs feel tight.',
    ],
    breathing: 'Steady breaths through the nose; let each exhale soften the heels down.',
    modifications: 'Bend the knees generously and lift the heels, or place the hands on a chair seat instead of the floor.',
    cautions: 'Come out of the pose if you feel wrist or shoulder discomfort; avoid long holds if you have been advised to avoid inversions.',
    difficulty: 'beginner',
    defaultHoldSeconds: 45,
    bilateral: false,
    focusAreas: ['shoulders', 'hamstrings', 'calves', 'back'],
  },
  {
    slug: 'plank-pose',
    name: 'Plank Pose',
    sanskritName: 'Phalakasana',
    description:
      'A core-strengthening hold that builds steadiness through the whole body in one long line.',
    instructions: [
      'From hands and knees, step both feet back so the body forms a straight line.',
      'Align wrists under shoulders and press the floor away.',
      'Engage the thighs and draw the lower belly in gently.',
      'Keep the neck in line with the spine, gaze just ahead of the hands.',
      'Breathe steadily and avoid letting the hips sag or pike.',
    ],
    breathing: 'Short, steady breaths; do not hold the breath.',
    modifications: 'Lower both knees to the floor for a half plank, or practise with forearms down.',
    cautions: 'Stop if the lower back sags or aches; a shorter, well-aligned hold is better than a long strained one.',
    difficulty: 'intermediate',
    defaultHoldSeconds: 30,
    bilateral: false,
    focusAreas: ['core', 'arms', 'shoulders'],
  },
  {
    slug: 'cobra-pose',
    name: 'Cobra Pose',
    sanskritName: 'Bhujangasana',
    description:
      'A gentle prone backbend that opens the chest and strengthens the muscles along the spine.',
    instructions: [
      'Lie face down with legs extended and the tops of the feet on the floor.',
      'Place the hands under the shoulders, elbows close to the body.',
      'On an inhale, press lightly through the hands to lift the chest.',
      'Keep the elbows softly bent and the shoulders rolling back and down.',
      'Lower slowly on an exhale.',
    ],
    breathing: 'Inhale to lift, exhale to lower; breathe comfortably while holding.',
    modifications: 'Keep the lift small and rest on the forearms (sphinx variation) for a gentler option.',
    cautions: 'Keep the backbend gentle and avoid this pose if a prone backbend causes back discomfort.',
    difficulty: 'beginner',
    defaultHoldSeconds: 30,
    bilateral: false,
    focusAreas: ['spine', 'chest', 'back'],
  },
  {
    slug: 'childs-pose',
    name: "Child's Pose",
    sanskritName: 'Balasana',
    description:
      'A restful forward fold that gently stretches the back and hips and offers a pause at any point in practice.',
    instructions: [
      'Kneel on the floor with big toes touching and knees as wide as comfortable.',
      'Sit the hips back toward the heels.',
      'Fold forward and rest the forehead on the floor or on stacked hands.',
      'Extend the arms forward or rest them alongside the body.',
      'Let the whole body relax into the shape.',
    ],
    breathing: 'Slow, deep breaths into the back of the body.',
    modifications: 'Place a cushion between the calves and thighs, or rest the forehead on a block or folded blanket.',
    difficulty: 'beginner',
    defaultHoldSeconds: 60,
    bilateral: false,
    focusAreas: ['back', 'hips', 'relaxation'],
  },
  {
    slug: 'bridge-pose',
    name: 'Bridge Pose',
    sanskritName: 'Setu Bandhasana',
    description:
      'A supine backbend that strengthens the glutes and hamstrings while opening the front of the hips and chest.',
    instructions: [
      'Lie on your back with knees bent and feet flat, hip-width apart.',
      'Press through the feet to lift the hips toward the ceiling.',
      'Keep the knees pointing forward and the thighs parallel.',
      'Roll the shoulders under slightly and keep the neck relaxed.',
      'Lower the hips slowly, one vertebra at a time.',
    ],
    breathing: 'Inhale to lift; breathe steadily in the hold and exhale to lower.',
    modifications: 'Place a block or firm cushion under the sacrum and rest the hips on it for a supported version.',
    cautions: 'Keep the feet and knees aligned and come down if the lower back feels compressed.',
    difficulty: 'beginner',
    defaultHoldSeconds: 40,
    bilateral: false,
    focusAreas: ['glutes', 'hamstrings', 'spine'],
  },
  {
    slug: 'warrior-i',
    name: 'Warrior I',
    sanskritName: 'Virabhadrasana I',
    description:
      'A strong standing lunge that builds leg strength and steadiness while the arms reach overhead.',
    instructions: [
      'Step one foot forward into a lunge and turn the back heel down at an angle.',
      'Bend the front knee toward a right angle, keeping it above the ankle.',
      'Square the hips toward the front as much as comfortable.',
      'Raise the arms overhead alongside the ears.',
      'Press into both feet and breathe steadily before switching sides.',
    ],
    breathing: 'Steady breaths; exhale to settle into the lunge, inhale to lengthen the spine.',
    modifications: 'Shorten the stance and reduce the knee bend, or keep the hands on the hips instead of overhead.',
    cautions: 'Keep the front knee tracking over the toes and avoid forcing the back knee straight if it strains.',
    difficulty: 'intermediate',
    defaultHoldSeconds: 30,
    bilateral: true,
    focusAreas: ['legs', 'hips', 'balance'],
  },
  {
    slug: 'warrior-ii',
    name: 'Warrior II',
    sanskritName: 'Virabhadrasana II',
    description:
      'A powerful wide stance that strengthens the legs and builds focus with the arms extended and gaze over the front hand.',
    instructions: [
      'Stand with feet wide apart and turn the front foot out 90 degrees.',
      'Bend the front knee toward a right angle, aligned over the ankle.',
      'Extend the arms out to the sides at shoulder height.',
      'Keep the torso upright and the back leg straight and strong.',
      'Gaze over the front fingertips and breathe steadily before switching sides.',
    ],
    breathing: 'Even breaths through the nose; soften the shoulders on each exhale.',
    modifications: 'Use a shorter stance and a smaller knee bend, or rest the front forearm lightly on the thigh.',
    cautions: 'Avoid letting the front knee collapse inward; it should point in the same direction as the toes.',
    difficulty: 'intermediate',
    defaultHoldSeconds: 30,
    bilateral: true,
    focusAreas: ['legs', 'shoulders', 'stamina'],
  },
  {
    slug: 'warrior-iii',
    name: 'Warrior III',
    sanskritName: 'Virabhadrasana III',
    description:
      'A single-leg balance that challenges the whole body to form one strong line from head to lifted heel.',
    instructions: [
      'Stand tall and shift weight onto one leg.',
      'Hinge forward from the hips while the other leg extends straight behind.',
      'Aim to bring the torso and lifted leg roughly parallel to the floor.',
      'Reach the arms forward, alongside the body, or keep hands at the heart.',
      'Fix the gaze on one still point and breathe before switching sides.',
    ],
    breathing: 'Slow, steady breaths; a wobbling breath usually means the body needs a smaller angle.',
    modifications: 'Keep the toes of the lifted foot resting on the floor behind you, or practise facing a wall with fingertips touching it.',
    cautions: 'This is an advanced balance — practise near support and come out of the pose rather than falling out of it.',
    difficulty: 'advanced',
    defaultHoldSeconds: 20,
    bilateral: true,
    focusAreas: ['balance', 'legs', 'core'],
  },
  {
    slug: 'triangle-pose',
    name: 'Triangle Pose',
    sanskritName: 'Trikonasana',
    description:
      'A wide standing side bend that stretches the legs and side body while opening the chest.',
    instructions: [
      'Stand with feet wide, front foot turned out and back foot slightly in.',
      'Extend both arms out to the sides at shoulder height.',
      'Reach the front arm forward, then hinge at the hip to lower the hand toward the shin or floor.',
      'Extend the top arm toward the ceiling and open the chest.',
      'Keep both legs straight and strong, then rise and switch sides.',
    ],
    breathing: 'Inhale to lengthen the spine; exhale to deepen the side bend gently.',
    modifications: 'Rest the lower hand on a block or on the shin rather than reaching for the floor.',
    cautions: 'Avoid locking the front knee and keep the bend coming from the hip, not the waist collapsing down.',
    difficulty: 'intermediate',
    defaultHoldSeconds: 30,
    bilateral: true,
    focusAreas: ['legs', 'side-body', 'chest'],
  },
  {
    slug: 'extended-side-angle',
    name: 'Extended Side Angle',
    sanskritName: 'Utthita Parsvakonasana',
    description:
      'A deep side-opening lunge that combines leg strength with a long stretch along the extended side of the body.',
    instructions: [
      'From a wide stance, turn the front foot out and bend the front knee over the ankle.',
      'Rest the front forearm lightly on the front thigh.',
      'Extend the top arm over the ear, creating one long line from heel to fingertips.',
      'Press the outer edge of the back foot into the floor.',
      'Breathe steadily, then rise and switch sides.',
    ],
    breathing: 'Full breaths into the extended side of the ribcage.',
    modifications: 'Keep the forearm on the thigh (rather than the hand to the floor) and shorten the stance.',
    cautions: 'Keep the front knee aligned over the ankle and avoid dumping weight into the supporting forearm.',
    difficulty: 'intermediate',
    defaultHoldSeconds: 30,
    bilateral: true,
    focusAreas: ['legs', 'side-body', 'hips'],
  },
  {
    slug: 'chair-pose',
    name: 'Chair Pose',
    sanskritName: 'Utkatasana',
    description:
      'A compact standing squat that builds heat and strength in the legs, glutes and core.',
    instructions: [
      'Stand with feet together or hip-width apart.',
      'Bend the knees and sit the hips back as if sitting into a chair.',
      'Raise the arms overhead alongside the ears.',
      'Keep the weight in the heels and the chest lifted.',
      'Hold with steady breaths, then stand tall to release.',
    ],
    breathing: 'Steady breaths; exhale to sit deeper only as far as form stays clean.',
    modifications: 'Keep the feet hip-width apart and reduce the depth of the sit, or keep hands at the heart.',
    cautions: 'Keep the knees tracking over the toes and avoid the lower back arching excessively.',
    difficulty: 'intermediate',
    defaultHoldSeconds: 30,
    bilateral: false,
    focusAreas: ['legs', 'glutes', 'core'],
  },
  {
    slug: 'tree-pose',
    name: 'Tree Pose',
    sanskritName: 'Vrksasana',
    description:
      'A classic standing balance that builds focus and ankle, leg and hip steadiness on one leg.',
    instructions: [
      'Stand tall and shift weight onto one leg.',
      'Place the sole of the other foot against the inner calf or inner thigh.',
      'Press the foot and leg into each other to find balance.',
      'Bring the palms together at the heart or raise the arms overhead.',
      'Fix the gaze on a still point, breathe, then switch sides.',
    ],
    breathing: 'Slow, calm breaths — balance steadies as the breath steadies.',
    modifications: 'Keep the toes of the raised foot on the floor with the heel against the ankle, like a kickstand, or practise beside a wall.',
    cautions: 'Never place the foot directly against the side of the knee joint; use the calf or thigh instead.',
    difficulty: 'beginner',
    defaultHoldSeconds: 30,
    bilateral: true,
    focusAreas: ['balance', 'legs', 'focus'],
  },
  {
    slug: 'eagle-pose',
    name: 'Eagle Pose',
    sanskritName: 'Garudasana',
    description:
      'A compact balancing wrap of the arms and legs that builds concentration and opens the shoulders and outer hips.',
    instructions: [
      'Stand tall, bend both knees slightly and shift weight onto one leg.',
      'Cross the other thigh over the top and hook the foot behind the calf if possible.',
      'Cross the arms in front of the chest, one elbow under the other, palms pressing together.',
      'Sit the hips down slightly and lift the elbows to shoulder height.',
      'Breathe steadily, unwind, and switch sides.',
    ],
    breathing: 'Slow breaths; exhale to sit a little deeper into the wrap.',
    modifications: 'Cross one leg over with the toes resting on the floor for balance, and hug the shoulders instead of wrapping the arms fully.',
    cautions: 'Practise near a wall if balance is unsteady, and skip the full leg wrap if it strains the knees.',
    difficulty: 'intermediate',
    defaultHoldSeconds: 20,
    bilateral: true,
    focusAreas: ['balance', 'shoulders', 'hips'],
  },
  {
    slug: 'low-lunge',
    name: 'Low Lunge',
    sanskritName: 'Anjaneyasana',
    description:
      'A kneeling lunge that stretches the front of the hip and thigh of the back leg while strengthening the front leg.',
    instructions: [
      'From hands and knees, step one foot forward between the hands.',
      'Align the front knee over the ankle and slide the back knee slightly behind the hips.',
      'Untuck the back toes and press the top of the back foot into the floor.',
      'Lift the torso upright and place hands on the front thigh or reach them overhead.',
      'Breathe steadily, then switch sides.',
    ],
    breathing: 'Inhale to lengthen the torso; exhale to soften the hips a little lower.',
    modifications: 'Place a folded blanket under the back knee and keep the hands on blocks or the front thigh.',
    cautions: 'Pad the back knee and avoid forcing the hips lower than feels stable.',
    difficulty: 'beginner',
    defaultHoldSeconds: 30,
    bilateral: true,
    focusAreas: ['hip-flexors', 'legs', 'hips'],
  },
  {
    slug: 'standing-forward-fold',
    name: 'Standing Forward Fold',
    sanskritName: 'Uttanasana',
    description:
      'A standing fold that releases the back of the body and lets the spine and neck hang heavy.',
    instructions: [
      'Stand with feet hip-width apart.',
      'Hinge forward from the hips with a long spine.',
      'Let the head and arms hang toward the floor.',
      'Soften the knees as much as needed.',
      'Roll up slowly to stand when finished.',
    ],
    breathing: 'Deep breaths; let each exhale release a little more weight downward.',
    modifications: 'Bend the knees generously and rest the hands on blocks, a chair, or the shins.',
    cautions: 'Roll up slowly to avoid light-headedness, and bend the knees if the hamstrings or back feel strained.',
    difficulty: 'beginner',
    defaultHoldSeconds: 40,
    bilateral: false,
    focusAreas: ['hamstrings', 'back', 'relaxation'],
  },
  {
    slug: 'seated-forward-fold',
    name: 'Seated Forward Fold',
    sanskritName: 'Paschimottanasana',
    description:
      'A seated fold that stretches the backs of the legs and the spine with a calm, steady breath.',
    instructions: [
      'Sit with both legs extended straight in front.',
      'Sit tall on the sitting bones and flex the feet.',
      'Hinge forward from the hips, reaching the hands toward the shins or feet.',
      'Keep the spine long rather than rounding to reach further.',
      'Breathe into the back of the body and release slowly.',
    ],
    breathing: 'Inhale to lengthen, exhale to fold a little deeper without forcing.',
    modifications: 'Sit on a folded blanket, bend the knees slightly, or loop a strap or towel around the feet.',
    cautions: 'Lead with the chest and stop deepening if you feel a sharp pull in the hamstrings or back.',
    difficulty: 'beginner',
    defaultHoldSeconds: 45,
    bilateral: false,
    focusAreas: ['hamstrings', 'back', 'relaxation'],
  },
  {
    slug: 'butterfly-pose',
    name: 'Butterfly Pose',
    sanskritName: 'Baddha Konasana',
    description:
      'A seated hip opener with the soles of the feet together, gently stretching the inner thighs and groin.',
    instructions: [
      'Sit tall and bring the soles of the feet together, knees falling out to the sides.',
      'Hold the feet or ankles with the hands.',
      'Press the thighs gently toward the floor without forcing.',
      'Lengthen the spine and relax the shoulders.',
      'Optionally fold forward slightly from the hips.',
    ],
    breathing: 'Slow, even breaths; soften into the shape on each exhale.',
    modifications: 'Place cushions or blocks under the knees for support and sit on a folded blanket.',
    cautions: 'Never press down hard on the knees; support them if the inner thighs feel strained.',
    difficulty: 'beginner',
    defaultHoldSeconds: 45,
    bilateral: false,
    focusAreas: ['hips', 'inner-thighs', 'back'],
  },
  {
    slug: 'pigeon-pose',
    name: 'Pigeon Pose',
    sanskritName: 'Eka Pada Rajakapotasana',
    description:
      'A deep hip-opening pose that stretches the glutes and outer hip of the front leg and the front of the back hip.',
    instructions: [
      'From hands and knees, bring one knee forward behind the same-side wrist.',
      'Angle the shin as comfortable and extend the other leg straight back.',
      'Square the hips toward the floor as much as possible.',
      'Walk the hands forward and fold over the front leg, or stay upright.',
      'Breathe deeply, then switch sides.',
    ],
    breathing: 'Long, slow exhales to soften into the stretch without forcing depth.',
    modifications: 'Place a cushion under the hip of the front leg and stay upright on the hands or forearms.',
    cautions: 'Keep pressure out of the knee joint; adjust the shin angle or use the supported variation if the knee feels strained.',
    difficulty: 'intermediate',
    defaultHoldSeconds: 45,
    bilateral: true,
    focusAreas: ['hips', 'glutes', 'hip-flexors'],
  },
  {
    slug: 'boat-pose',
    name: 'Boat Pose',
    sanskritName: 'Navasana',
    description:
      'A seated balance on the sitting bones that strengthens the core and hip flexors.',
    instructions: [
      'Sit with knees bent and feet flat on the floor.',
      'Lean back slightly and lift the feet until the shins are parallel to the floor.',
      'Extend the arms forward alongside the legs.',
      'Lift the chest and keep the spine long.',
      'For the full pose, straighten the legs into a V shape; lower with control.',
    ],
    breathing: 'Short, steady breaths — keep breathing rather than bracing and holding.',
    modifications: 'Keep the hands on the floor behind the hips for support, or keep the feet down and lift one foot at a time.',
    cautions: 'Keep the chest lifted so the lower back does not round heavily under strain; come down and rest as needed.',
    difficulty: 'intermediate',
    defaultHoldSeconds: 25,
    bilateral: false,
    focusAreas: ['core', 'hip-flexors', 'balance'],
  },
  {
    slug: 'supine-twist',
    name: 'Supine Twist',
    sanskritName: 'Supta Matsyendrasana',
    description:
      'A reclining spinal twist that releases the back and outer hip while the body rests fully on the floor.',
    instructions: [
      'Lie on your back and draw one knee toward the chest.',
      'Guide the knee across the body toward the opposite side.',
      'Extend the opposite arm out to the side and rest the other hand on the knee.',
      'Keep both shoulders resting toward the floor.',
      'Breathe into the twist, then switch sides.',
    ],
    breathing: 'Exhale to settle into the twist; inhale to create space along the spine.',
    modifications: 'Place a cushion under the crossed knee so the leg can rest without forcing the twist.',
    cautions: 'Keep the twist gentle and avoid forcing the knee to the floor if the opposite shoulder lifts or the back complains.',
    difficulty: 'beginner',
    defaultHoldSeconds: 40,
    bilateral: false,
    focusAreas: ['spine', 'hips', 'relaxation'],
  },
  {
    slug: 'legs-up-the-wall',
    name: 'Legs Up the Wall',
    sanskritName: 'Viparita Karani',
    description:
      'A restful supported inversion where the legs rest up a wall and the whole body can fully let go.',
    instructions: [
      'Sit sideways next to a wall and swing the legs up as you lie back.',
      'Rest the heels against the wall with legs extended or softly bent.',
      'Let the arms rest alongside the body, palms up.',
      'Close the eyes and breathe naturally.',
      'To finish, bend the knees, roll to one side and rest before sitting up.',
    ],
    breathing: 'Slow, natural breathing with a slightly longer exhale.',
    modifications: 'Rest the calves on a chair seat instead of a wall, or place a folded blanket under the hips.',
    cautions: 'Come out of the pose if the legs tingle persistently, and rise slowly to avoid light-headedness.',
    difficulty: 'beginner',
    defaultHoldSeconds: 120,
    bilateral: false,
    focusAreas: ['legs', 'relaxation', 'back'],
  },
  {
    slug: 'corpse-pose',
    name: 'Corpse Pose',
    sanskritName: 'Savasana',
    description:
      'The closing rest of a yoga practice: lying still with the body fully supported so the breath and mind can settle.',
    instructions: [
      'Lie on your back with legs extended, feet falling open.',
      'Rest the arms alongside the body, palms facing up.',
      'Close the eyes and let the body grow heavy into the floor.',
      'Release any control of the breath and simply rest.',
      'To finish, deepen the breath, move gently, and roll to one side before sitting up.',
    ],
    breathing: 'Completely natural breathing; no technique required.',
    modifications: 'Place a cushion under the knees or a blanket over the body for warmth and comfort.',
    difficulty: 'beginner',
    defaultHoldSeconds: 120,
    bilateral: false,
    focusAreas: ['relaxation', 'full-body'],
  },
];

export const YOGA_SEQUENCES: YogaSequenceSeed[] = [
  {
    slug: 'beginner-yoga-foundations',
    title: 'Beginner Yoga Foundations',
    category: 'beginner',
    level: 'beginner',
    description:
      'A gentle introduction to the essential shapes of yoga. Move slowly, use the modifications whenever you like, and rest in Child\'s Pose at any time.',
    safetyNotes:
      'Move within a comfortable range and never force a stretch. Props such as cushions, blocks or a chair are welcome in every pose.',
    metValue: 2.5,
    poses: [
      { poseSlug: 'mountain-pose', holdSeconds: 30, cue: 'Arrive standing tall and steady.' },
      { poseSlug: 'easy-pose', holdSeconds: 45, cue: 'Settle in and find a slow, even breath.' },
      { poseSlug: 'cat-cow', holdSeconds: 45, cue: 'Flow with the breath — this is a moving hold.' },
      { poseSlug: 'cobra-pose', holdSeconds: 25, cue: 'Keep the lift small and easy.' },
      { poseSlug: 'childs-pose', holdSeconds: 45, cue: 'Rest here whenever you need a pause.' },
      { poseSlug: 'bridge-pose', holdSeconds: 35, cue: 'Press through the feet and lift smoothly.' },
      { poseSlug: 'butterfly-pose', holdSeconds: 40, cue: 'Let the knees fall open without forcing.' },
      { poseSlug: 'corpse-pose', holdSeconds: 90, cue: 'Full rest. Let the whole body soften.' },
    ],
  },
  {
    slug: 'morning-energy-flow',
    title: 'Morning Energy Flow',
    category: 'morning',
    level: 'beginner',
    description:
      'A bright, steady flow to wake up the spine, hips and legs at the start of the day. Both sides of every standing pose are included.',
    safetyNotes:
      'The body can feel stiffer in the morning — keep the first round of every pose gentle and deepen only if it feels good.',
    metValue: 3.0,
    poses: [
      { poseSlug: 'easy-pose', holdSeconds: 30, cue: 'A few slow breaths to wake up the body.' },
      { poseSlug: 'cat-cow', holdSeconds: 40, cue: 'Warm the spine with breath-led movement.' },
      { poseSlug: 'downward-facing-dog', holdSeconds: 40, cue: 'Pedal the feet and wake up the legs.' },
      { poseSlug: 'low-lunge', holdSeconds: 25, side: 'each', cue: 'Open the front of the hips, one side at a time.' },
      { poseSlug: 'warrior-i', holdSeconds: 25, side: 'each', cue: 'Strong legs, arms reaching up to the day.' },
      { poseSlug: 'standing-forward-fold', holdSeconds: 35, cue: 'Let the spine hang and the neck go.' },
      { poseSlug: 'chair-pose', holdSeconds: 25, cue: 'Build a little warmth to finish the standing work.' },
      { poseSlug: 'mountain-pose', holdSeconds: 30, cue: 'Stand tall and feel the effect of the flow.' },
      { poseSlug: 'corpse-pose', holdSeconds: 60, cue: 'One minute of complete rest.' },
    ],
  },
  {
    slug: 'flexibility-deep-stretch',
    title: 'Flexibility & Deep Stretch',
    category: 'flexibility',
    level: 'beginner',
    description:
      'Long, unhurried holds for the hips, hamstrings and spine. Flexibility work should feel like a stretch you can breathe in — never a strain.',
    safetyNotes:
      'Stretch only to the point of mild tension. Muscles release gradually; forcing depth works against the goal of the session.',
    metValue: 2.5,
    poses: [
      { poseSlug: 'cat-cow', holdSeconds: 40, cue: 'Loosen the spine before the deeper holds.' },
      { poseSlug: 'low-lunge', holdSeconds: 40, side: 'each', cue: 'Long hold for the front of each hip.' },
      { poseSlug: 'pigeon-pose', holdSeconds: 60, side: 'each', cue: 'The deepest hip opener — use a cushion under the hip if you like.' },
      { poseSlug: 'seated-forward-fold', holdSeconds: 60, cue: 'Long spine first, depth second.' },
      { poseSlug: 'butterfly-pose', holdSeconds: 60, cue: 'Soften the inner thighs with each exhale.' },
      { poseSlug: 'standing-forward-fold', holdSeconds: 45, cue: 'Let gravity do the work.' },
      { poseSlug: 'supine-twist', holdSeconds: 40, side: 'each', cue: 'Release the back, one side at a time.' },
      { poseSlug: 'legs-up-the-wall', holdSeconds: 90, cue: 'Finish with the legs fully supported.' },
    ],
  },
  {
    slug: 'strength-yoga-power',
    title: 'Strength Yoga Power',
    category: 'strength',
    level: 'intermediate',
    description:
      'A demanding strength-focused session built on plank, chair, boat and bridge. Expect the muscles to work hard — rest in Child\'s Pose whenever form fades.',
    safetyNotes:
      'Quality over duration: a shorter hold with clean alignment builds more strength than a long hold with sagging form.',
    metValue: 4.0,
    poses: [
      { poseSlug: 'mountain-pose', holdSeconds: 20, cue: 'Set your stance and your breath.' },
      { poseSlug: 'chair-pose', holdSeconds: 30, cue: 'Sit deep, chest tall, weight in the heels.' },
      { poseSlug: 'plank-pose', holdSeconds: 30, cue: 'One long line — knees down if the back sags.' },
      { poseSlug: 'downward-facing-dog', holdSeconds: 30, cue: 'Press the floor away and breathe.' },
      { poseSlug: 'warrior-iii', holdSeconds: 20, side: 'each', cue: 'Balance and strength together, one leg at a time.' },
      { poseSlug: 'boat-pose', holdSeconds: 25, cue: 'Chest lifted, steady breaths.' },
      { poseSlug: 'bridge-pose', holdSeconds: 40, cue: 'Strong glutes to finish the strength work.' },
      { poseSlug: 'childs-pose', holdSeconds: 45, cue: 'Recover fully before the final rest.' },
      { poseSlug: 'corpse-pose', holdSeconds: 60, cue: 'Complete rest — you have earned it.' },
    ],
  },
  {
    slug: 'balance-stability-flow',
    title: 'Balance & Stability Flow',
    category: 'balance',
    level: 'intermediate',
    description:
      'Single-leg balances and steady transitions to build ankle, leg and core stability. Wobbling is part of the training — practise near a wall or chair.',
    safetyNotes:
      'Keep support within reach for every standing balance, and step out of a pose rather than falling out of it.',
    metValue: 3.0,
    poses: [
      { poseSlug: 'mountain-pose', holdSeconds: 30, cue: 'Find your centre before you challenge it.' },
      { poseSlug: 'tree-pose', holdSeconds: 30, side: 'each', cue: 'Foot to calf or thigh — never the knee.' },
      { poseSlug: 'eagle-pose', holdSeconds: 20, side: 'each', cue: 'Wrap, sit down, lift the elbows.' },
      { poseSlug: 'warrior-iii', holdSeconds: 20, side: 'each', cue: 'Toes can stay down behind you as a kickstand.' },
      { poseSlug: 'warrior-ii', holdSeconds: 25, side: 'each', cue: 'A grounded contrast — strong and still.' },
      { poseSlug: 'chair-pose', holdSeconds: 25, cue: 'Both feet down, deep sit, steady gaze.' },
      { poseSlug: 'standing-forward-fold', holdSeconds: 35, cue: 'Shake out the legs and reset.' },
      { poseSlug: 'corpse-pose', holdSeconds: 60, cue: 'Rest and let the nervous system settle.' },
    ],
  },
  {
    slug: 'relaxation-and-breathing',
    title: 'Relaxation & Breathing',
    category: 'relaxation-breathing',
    level: 'beginner',
    description:
      'A slow, floor-based session of long restful holds and unhurried breathing. Ideal in the evening or whenever the goal is simply to unwind.',
    safetyNotes:
      'Support the body generously with cushions and blankets. If lying flat is uncomfortable, practise the seated and wall poses only.',
    metValue: 2.0,
    poses: [
      { poseSlug: 'easy-pose', holdSeconds: 120, cue: 'Seated breath awareness — let each exhale grow a little longer than the inhale.' },
      { poseSlug: 'cat-cow', holdSeconds: 45, cue: 'The only movement of the session — slow and breath-led.' },
      { poseSlug: 'childs-pose', holdSeconds: 90, cue: 'Rest the forehead down and breathe into the back.' },
      { poseSlug: 'supine-twist', holdSeconds: 45, side: 'each', cue: 'A gentle wringing-out of the day, one side at a time.' },
      { poseSlug: 'butterfly-pose', holdSeconds: 60, cue: 'Support the knees and simply rest here.' },
      { poseSlug: 'legs-up-the-wall', holdSeconds: 120, cue: 'Legs fully supported; nothing to do but breathe.' },
      { poseSlug: 'corpse-pose', holdSeconds: 180, cue: 'Three full minutes of complete rest to close the practice.' },
    ],
  },
  {
    slug: 'full-body-yoga-flow',
    title: 'Full-Body Yoga Flow',
    category: 'full-body',
    level: 'intermediate',
    description:
      'A complete practice that moves through standing strength, balance, hip opening and floor work — every major area of the body in one session.',
    safetyNotes:
      'This is the longest yoga session in the catalog. Take Child\'s Pose breaks whenever needed; they are part of the practice, not a pause in it.',
    metValue: 3.5,
    poses: [
      { poseSlug: 'mountain-pose', holdSeconds: 25, cue: 'Arrive and align.' },
      { poseSlug: 'cat-cow', holdSeconds: 40, cue: 'Warm the spine in both directions.' },
      { poseSlug: 'downward-facing-dog', holdSeconds: 40, cue: 'Lengthen the whole back line of the body.' },
      { poseSlug: 'plank-pose', holdSeconds: 25, cue: 'Core on — one clean line.' },
      { poseSlug: 'low-lunge', holdSeconds: 25, side: 'each', cue: 'Step through and open the hips.' },
      { poseSlug: 'warrior-ii', holdSeconds: 25, side: 'each', cue: 'Wide, strong and steady.' },
      { poseSlug: 'triangle-pose', holdSeconds: 25, side: 'each', cue: 'Lengthen both sides of the torso.' },
      { poseSlug: 'extended-side-angle', holdSeconds: 20, side: 'each', cue: 'One long line from back heel to fingertips.' },
      { poseSlug: 'chair-pose', holdSeconds: 25, cue: 'Final standing effort.' },
      { poseSlug: 'bridge-pose', holdSeconds: 35, cue: 'Move to the floor with glute strength.' },
      { poseSlug: 'pigeon-pose', holdSeconds: 40, side: 'each', cue: 'Deep hip release, both sides.' },
      { poseSlug: 'supine-twist', holdSeconds: 35, side: 'each', cue: 'Wind down the spine.' },
      { poseSlug: 'corpse-pose', holdSeconds: 90, cue: 'Close the practice in full rest.' },
    ],
  },
];

export const AEROBIC_ROUTINES: AerobicRoutineSeed[] = [
  {
    slug: 'beginner-aerobics-starter',
    title: 'Beginner Aerobics Starter',
    category: 'beginner',
    level: 'beginner',
    intensity: 'low-moderate',
    metValue: 5.0,
    description:
      'A friendly first aerobics session: simple marching, step touches and knee lifts at a pace you can talk through. No jumping, no floor work.',
    safetyNotes:
      'You should be able to speak in short sentences throughout. Slow down or march in place whenever you need to — that still counts.',
    steps: [
      { phase: 'warmup', name: 'March in Place', durationSeconds: 60, cue: 'Start gently, arms swinging naturally.' },
      { phase: 'warmup', name: 'Shoulder Rolls & Arm Circles', durationSeconds: 45, cue: 'Loosen the shoulders while the feet keep marching.' },
      { phase: 'warmup', name: 'Easy Side Steps', durationSeconds: 60, cue: 'Step wide, tap together, keep the knees soft.' },
      { phase: 'warmup', name: 'Gentle Knee Lifts', durationSeconds: 45, cue: 'Lift only as high as comfortable.' },
      { phase: 'main', name: 'Step Touch', durationSeconds: 120, cue: 'Step out and touch, side to side, add a clap if you like.', lowImpactAlternative: 'Make the steps smaller and skip the clap.' },
      { phase: 'main', name: 'March & Reach', durationSeconds: 60, cue: 'March while reaching the arms up and across.', lowImpactAlternative: 'Reach only to shoulder height.' },
      { phase: 'main', name: 'Heel Digs', durationSeconds: 60, cue: 'Dig one heel forward at a time, arms punching gently forward.', lowImpactAlternative: 'Slow the tempo and lower the arms.' },
      { phase: 'main', name: 'Easy Grapevine', durationSeconds: 90, cue: 'Step side, cross behind, step side, tap — then reverse.', lowImpactAlternative: 'Replace the cross-behind with a simple step together.' },
      { phase: 'main', name: 'Knee Lifts', durationSeconds: 60, cue: 'Lift the knee toward the opposite elbow.', lowImpactAlternative: 'Lift the knee only to hip height or lower, without the twist.' },
      { phase: 'main', name: 'Shallow Step-Out Squats', durationSeconds: 60, cue: 'Step out, sit a few inches down, step back together.', lowImpactAlternative: 'Skip the squat and keep stepping side to side.' },
      { phase: 'main', name: 'Recovery March', durationSeconds: 30, cue: 'Bring the effort down, breathe deeply.', lowImpactAlternative: 'Stand still and breathe if you need a full rest.' },
      { phase: 'cooldown', name: 'Easy March & Slow Down', durationSeconds: 60, cue: 'Gradually reduce the pace until the breathing settles.' },
      { phase: 'cooldown', name: 'Standing Calf & Quad Stretch', durationSeconds: 60, cue: 'Hold a wall or chair for balance; 30 seconds per side.' },
      { phase: 'cooldown', name: 'Deep Breathing', durationSeconds: 60, cue: 'Inhale through the nose, long slow exhale through the mouth.' },
    ],
  },
  {
    slug: 'low-impact-aerobics',
    title: 'Low-Impact Aerobics',
    category: 'low-impact',
    level: 'beginner',
    intensity: 'low',
    metValue: 4.5,
    description:
      'A joint-friendly full session where one foot stays on the floor at all times. No jumping, no jogging — just continuous, flowing movement.',
    safetyNotes:
      'Keep movements smooth and controlled. Supportive footwear and a clear floor space make this session safer and more comfortable.',
    steps: [
      { phase: 'warmup', name: 'Walking in Place', durationSeconds: 90, cue: 'Build warmth gradually over the full 90 seconds.' },
      { phase: 'warmup', name: 'Side Steps with Arm Swings', durationSeconds: 60, cue: 'Swing the arms across the body as you step.' },
      { phase: 'warmup', name: 'Heel & Toe Taps', durationSeconds: 60, cue: 'Tap heels and toes in front, waking up the ankles.' },
      { phase: 'warmup', name: 'Gentle Torso Rotations', durationSeconds: 30, cue: 'Rotate only as far as feels easy.' },
      { phase: 'main', name: 'Step Touch with Reach', durationSeconds: 120, cue: 'Reach the arms toward the stepping foot.' },
      { phase: 'main', name: 'Low Knee Lifts', durationSeconds: 90, cue: 'Lift to a comfortable height, hands on hips or reaching down.' },
      { phase: 'main', name: 'Hamstring Curls (Standing)', durationSeconds: 90, cue: 'Kick the heel toward the glute, alternating sides.' },
      { phase: 'main', name: 'Grapevine', durationSeconds: 120, cue: 'Travel side to side with the cross-behind step.' },
      { phase: 'main', name: 'Step-Out Mini Squats', durationSeconds: 90, cue: 'Small, controlled sit-backs with every step out.' },
      { phase: 'main', name: 'Front & Side Taps', durationSeconds: 90, cue: 'Tap front, tap side, alternate — keep the standing leg soft.' },
      { phase: 'main', name: 'March with Arm Pull-Downs', durationSeconds: 90, cue: 'Pull the elbows down from overhead as you march.' },
      { phase: 'main', name: 'Easy V-Step', durationSeconds: 90, cue: 'Step forward-wide, forward-wide, back together — a V on the floor.' },
      { phase: 'cooldown', name: 'Slow Side Steps', durationSeconds: 60, cue: 'Let the heart rate drift down.' },
      { phase: 'cooldown', name: 'Standing Side & Chest Stretch', durationSeconds: 60, cue: 'Open the chest, then stretch each side of the torso.' },
      { phase: 'cooldown', name: 'Breathing & Shoulder Release', durationSeconds: 60, cue: 'Roll the shoulders down and breathe out slowly.' },
    ],
  },
  {
    slug: 'dance-aerobics-party',
    title: 'Dance Aerobics Party',
    category: 'dance',
    level: 'intermediate',
    intensity: 'moderate',
    metValue: 6.5,
    description:
      'A rhythm-driven session of grapevines, chassés, knee lifts and turns. It should feel like dancing in your living room — accuracy matters less than keeping moving.',
    safetyNotes:
      'Clear enough floor space to travel safely, and skip or walk through any turn that makes you dizzy.',
    steps: [
      { phase: 'warmup', name: 'Bounce & Groove in Place', durationSeconds: 60, cue: 'Find the beat with a soft bounce through the knees.' },
      { phase: 'warmup', name: 'Step Touch with Hip Sway', durationSeconds: 60, cue: 'Let the hips lead the step touches.' },
      { phase: 'warmup', name: 'Shoulder Shimmies & Rolls', durationSeconds: 60, cue: 'Loosen the upper body, keep the feet moving.' },
      { phase: 'main', name: 'Grapevine & Clap', durationSeconds: 180, cue: 'Travel across the floor, clap on the tap.', lowImpactAlternative: 'Slow the tempo and remove the clap travel — grapevine in place.' },
      { phase: 'main', name: 'Chassé Side to Side', durationSeconds: 120, cue: 'Step-together-step with a light bounce.', lowImpactAlternative: 'Replace the chassé with quick step touches.' },
      { phase: 'main', name: 'Knee Lift & Twist Combo', durationSeconds: 120, cue: 'Knee up, twist toward it, alternate sides.', lowImpactAlternative: 'Lower the knee and drop the twist.' },
      { phase: 'main', name: 'Mambo Step', durationSeconds: 120, cue: 'Step forward and rock, back and rock, to the beat.', lowImpactAlternative: 'Take smaller steps and slow the rhythm.' },
      { phase: 'main', name: 'Box Step with Arms', durationSeconds: 180, cue: 'Trace a square on the floor, arms styling freely.', lowImpactAlternative: 'Walk the box step slowly without arm styling.' },
      { phase: 'main', name: 'Heel Jacks (Easy)', durationSeconds: 120, cue: 'Jump the feet out into heel digs — or step them out.', lowImpactAlternative: 'Step out to heel digs one foot at a time — no jump.' },
      { phase: 'main', name: 'Freestyle Groove', durationSeconds: 150, cue: 'Your favourite moves — just keep the beat and keep moving.', lowImpactAlternative: 'March and groove in place at your own intensity.' },
      { phase: 'main', name: 'Final Chorus Combo', durationSeconds: 150, cue: 'Grapevine, knee lifts, box step — put it all together.', lowImpactAlternative: 'Pick your favourite move from the session and repeat it.' },
      { phase: 'cooldown', name: 'Slow Groove & March', durationSeconds: 60, cue: 'Bring the tempo down gradually.' },
      { phase: 'cooldown', name: 'Side Stretch & Arm Reach', durationSeconds: 60, cue: 'Stretch tall through each side.' },
      { phase: 'cooldown', name: 'Deep Breathing', durationSeconds: 60, cue: 'Shoulders down, long exhales.' },
    ],
  },
  {
    slug: 'moderate-cardio-aerobics',
    title: 'Moderate Cardio Aerobics',
    category: 'moderate-cardio',
    level: 'intermediate',
    intensity: 'moderate-high',
    metValue: 7.0,
    description:
      'A steady, purposeful cardio session: jogging intervals, jumping jacks and travelling steps that keep the heart rate up for the full main block.',
    safetyNotes:
      'Work at an effort where speech is limited to a few words at a time. Drop to the low-impact option in any step whenever you need to recover.',
    steps: [
      { phase: 'warmup', name: 'Brisk March', durationSeconds: 60, cue: 'Build pace quickly but stay controlled.' },
      { phase: 'warmup', name: 'Jog in Place (Easy)', durationSeconds: 60, cue: 'Light feet, tall posture.' },
      { phase: 'warmup', name: 'Dynamic Leg Swings & Arm Circles', durationSeconds: 60, cue: 'Prepare the hips, knees and shoulders for bigger movement.' },
      { phase: 'main', name: 'Jumping Jacks', durationSeconds: 120, cue: 'Full range, light landing.', lowImpactAlternative: 'Step one foot out at a time with the same arm movement.' },
      { phase: 'main', name: 'Jog in Place — Steady', durationSeconds: 180, cue: 'Settle into a rhythm you can hold.', lowImpactAlternative: 'Brisk march with high knees.' },
      { phase: 'main', name: 'Travelling Step Kicks', durationSeconds: 120, cue: 'Move forward and back with low front kicks.', lowImpactAlternative: 'Replace kicks with knee lifts while travelling.' },
      { phase: 'main', name: 'Skater Steps', durationSeconds: 120, cue: 'Leap or step side to side, landing softly.', lowImpactAlternative: 'Wide side steps with a shallow knee bend.' },
      { phase: 'main', name: 'High Knees', durationSeconds: 90, cue: 'Drive the knees up, pump the arms.', lowImpactAlternative: 'Fast march with moderate knee lifts.' },
      { phase: 'main', name: 'Grapevine Intervals', durationSeconds: 180, cue: 'Travel fast, turn, travel back.', lowImpactAlternative: 'Slow grapevine with step-together pauses.' },
      { phase: 'main', name: 'Squat to Calf Raise', durationSeconds: 120, cue: 'Sit down, stand tall, rise onto the toes.', lowImpactAlternative: 'Shallower squat, skip the calf raise.' },
      { phase: 'main', name: 'Final Push — Jacks & Jog Mix', durationSeconds: 180, cue: 'Alternate 30 seconds of jacks with 30 seconds of jogging.', lowImpactAlternative: 'Alternate step-jacks with brisk marching.' },
      { phase: 'cooldown', name: 'Easy Jog to March', durationSeconds: 60, cue: 'Ease down step by step.' },
      { phase: 'cooldown', name: 'Quad, Calf & Hip Flexor Stretch', durationSeconds: 90, cue: 'About 30 seconds per stretch; use support for balance.' },
      { phase: 'cooldown', name: 'Deep Breathing', durationSeconds: 60, cue: 'Slow the breath deliberately.' },
    ],
  },
  {
    slug: 'full-body-aerobics-blast',
    title: 'Full-Body Aerobics Blast',
    category: 'full-body',
    level: 'intermediate',
    intensity: 'high',
    metValue: 7.5,
    description:
      'Thirty minutes that pair classic aerobics steps with bodyweight strength moves — squats, lunges and floor core work — for a complete full-body session.',
    safetyNotes:
      'Technique comes first in the strength steps: slow down and reduce the range before you let form slip. Rest or march in place whenever needed.',
    steps: [
      { phase: 'warmup', name: 'March to Jog Build', durationSeconds: 90, cue: 'Ninety seconds to go from walking to an easy jog.' },
      { phase: 'warmup', name: 'Bodyweight Squats (Easy)', durationSeconds: 60, cue: 'Wake up the legs with shallow, smooth squats.' },
      { phase: 'warmup', name: 'Arm Circles & Torso Rotations', durationSeconds: 30, cue: 'Open the shoulders and warm the trunk.' },
      { phase: 'main', name: 'Jumping Jacks', durationSeconds: 120, cue: 'Big range, quiet landings.', lowImpactAlternative: 'Step-jacks, one foot at a time.' },
      { phase: 'main', name: 'Squat & Reach Circuit', durationSeconds: 180, cue: 'Squat, stand, reach overhead — continuous rhythm.', lowImpactAlternative: 'Shallower squats without the overhead reach.' },
      { phase: 'main', name: 'Alternating Reverse Lunges', durationSeconds: 180, cue: 'Step back, bend both knees, drive up through the front heel.', lowImpactAlternative: 'Smaller step back and a shallower bend; hold support if needed.' },
      { phase: 'main', name: 'Travelling Grapevine', durationSeconds: 120, cue: 'Keep the heart rate up between strength blocks.', lowImpactAlternative: 'Slow grapevine in place.' },
      { phase: 'main', name: 'Mountain Climbers (Floor)', durationSeconds: 150, cue: 'Hands under shoulders, drive the knees with control.', lowImpactAlternative: 'Slow the pace right down, or elevate the hands on a step or chair.' },
      { phase: 'main', name: 'Skaters', durationSeconds: 120, cue: 'Travel side to side with a strong push-off.', lowImpactAlternative: 'Wide side steps with a mini squat.' },
      { phase: 'main', name: 'Standing Core — Knee-to-Elbow', durationSeconds: 120, cue: 'Crunch the obliques as the knee drives up.', lowImpactAlternative: 'Knee lifts without the twist.' },
      { phase: 'main', name: 'Burpee Walkouts (No Jump)', durationSeconds: 180, cue: 'Walk out to plank, walk back, stand tall.', lowImpactAlternative: 'Walk out only as far as a strong half plank, or stay with squat-to-stand.' },
      { phase: 'main', name: 'Final Jacks Sprint', durationSeconds: 150, cue: 'Last cardio push — best effort with clean form.', lowImpactAlternative: 'Fast step-jacks or brisk marching.' },
      { phase: 'cooldown', name: 'March & Breathe', durationSeconds: 90, cue: 'Walk it off, slow the breathing.' },
      { phase: 'cooldown', name: 'Full-Body Stretch Circuit', durationSeconds: 150, cue: 'Calves, quads, hamstrings, chest and shoulders — about 25 seconds each.' },
      { phase: 'cooldown', name: 'Deep Breathing', durationSeconds: 60, cue: 'Close the session with slow, full breaths.' },
    ],
  },
  {
    slug: 'advanced-aerobics-conditioning',
    title: 'Advanced Aerobics Conditioning',
    category: 'advanced',
    level: 'advanced',
    intensity: 'high',
    metValue: 8.5,
    description:
      'A demanding conditioning session: plyometric intervals, fast footwork and sustained high knees. Built for experienced exercisers who already train at high intensity.',
    safetyNotes:
      'This session includes jumping. Land softly with knees tracking over toes, and switch to the low-impact option immediately if joints complain or form breaks down.',
    steps: [
      { phase: 'warmup', name: 'Jog Build', durationSeconds: 60, cue: 'Build from march to a strong jog.' },
      { phase: 'warmup', name: 'Dynamic Mobility Circuit', durationSeconds: 60, cue: 'Leg swings, hip openers and arm swings — keep moving.' },
      { phase: 'warmup', name: 'Easy Jacks & High Knees', durationSeconds: 60, cue: 'Rehearse the main moves at half intensity.' },
      { phase: 'main', name: 'Plyo Jacks', durationSeconds: 150, cue: 'Explode up from a quarter squat into the jack.', lowImpactAlternative: 'Fast step-jacks with a small squat.' },
      { phase: 'main', name: 'High Knees — Intervals', durationSeconds: 180, cue: 'Alternate 20 seconds flat-out with 10 seconds easy.', lowImpactAlternative: 'Fast marching at a steady hard effort.' },
      { phase: 'main', name: 'Tuck Jumps (Low)', durationSeconds: 90, cue: 'Small, sharp jumps pulling the knees up.', lowImpactAlternative: 'Quick squat-to-calf-raise instead of jumping.' },
      { phase: 'main', name: 'Fast Skaters', durationSeconds: 120, cue: 'Big lateral bounds, stick each landing briefly.', lowImpactAlternative: 'Fast wide side steps.' },
      { phase: 'main', name: 'Burpees (Full)', durationSeconds: 180, cue: 'Chest to floor, jump at the top — quality reps only.', lowImpactAlternative: 'Walkout burpees without the push-up or jump.' },
      { phase: 'main', name: 'Sprint in Place', durationSeconds: 150, cue: 'Maximum cadence, tall posture, strong arms.', lowImpactAlternative: 'Fastest sustainable march.' },
      { phase: 'main', name: 'Jump Lunges', durationSeconds: 90, cue: 'Switch legs in the air, land softly into the lunge.', lowImpactAlternative: 'Alternating reverse lunges at speed.' },
      { phase: 'main', name: 'Agility Fast Feet', durationSeconds: 150, cue: 'Tiny, rapid steps — forward, back, side to side on command.', lowImpactAlternative: 'The same pattern at marching tempo.' },
      { phase: 'main', name: 'Final Conditioning Combo', durationSeconds: 180, cue: '30 seconds each: jacks, high knees, skaters — repeat.', lowImpactAlternative: 'Step versions of the same three moves.' },
      { phase: 'cooldown', name: 'Jog Down to Walk', durationSeconds: 120, cue: 'Ninety seconds to bring the heart rate right down.' },
      { phase: 'cooldown', name: 'Deep Stretch Circuit', durationSeconds: 150, cue: 'Quads, hamstrings, calves, glutes and chest — hold each with slow breathing.' },
      { phase: 'cooldown', name: 'Deep Breathing', durationSeconds: 60, cue: 'Finish fully recovered and breathing slowly.' },
    ],
  },
];

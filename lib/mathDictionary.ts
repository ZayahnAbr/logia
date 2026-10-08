// Curated first-year maths/stats reference. `tex` renders with KaTeX; `plain` is what gets
// inserted into a note (readable without a maths renderer).
export type MathTerm = { term: string; topic: string; def: string; tex?: string; plain?: string; example?: string; aka?: string[] };

export const MATH_TERMS: MathTerm[] = [
  // Algebra
  { term: "Quadratic formula", topic: "Algebra", def: "Gives the roots of ax² + bx + c = 0 (a ≠ 0).", tex: "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}", plain: "x = (−b ± √(b² − 4ac)) / 2a", example: "x² − 5x + 6 = 0 gives x = 2 or x = 3." },
  { term: "Discriminant", topic: "Algebra", def: "Tells you how many real roots a quadratic has: positive means two, zero means one (repeated), negative means none.", tex: "\\Delta = b^2 - 4ac", plain: "Δ = b² − 4ac" },
  { term: "Difference of squares", topic: "Algebra", def: "Factorises the difference of two squares.", tex: "a^2 - b^2 = (a - b)(a + b)", plain: "a² − b² = (a − b)(a + b)", example: "x² − 9 = (x − 3)(x + 3)" },
  { term: "Laws of exponents", topic: "Algebra", def: "Rules for multiplying, dividing and raising powers with the same base.", tex: "a^m a^n = a^{m+n},\\quad \\frac{a^m}{a^n} = a^{m-n},\\quad (a^m)^n = a^{mn}", plain: "aᵐ·aⁿ = aᵐ⁺ⁿ, aᵐ/aⁿ = aᵐ⁻ⁿ, (aᵐ)ⁿ = aᵐⁿ", aka: ["index laws", "power rules"] },
  { term: "Logarithm", topic: "Algebra", def: "The power you raise the base to in order to get a number.", tex: "\\log_b x = y \\iff b^y = x", plain: "log_b(x) = y  ⇔  bʸ = x", example: "log₂ 8 = 3 because 2³ = 8." },
  { term: "Log laws", topic: "Algebra", def: "Rules for combining logarithms with the same base.", tex: "\\log(xy) = \\log x + \\log y,\\quad \\log\\frac{x}{y} = \\log x - \\log y,\\quad \\log x^k = k\\log x", plain: "log(xy) = log x + log y; log(x/y) = log x − log y; log(xᵏ) = k·log x" },
  { term: "Arithmetic sequence", topic: "Algebra", def: "Each term adds a constant difference d. The nth term and the sum of the first n terms:", tex: "T_n = a + (n-1)d,\\quad S_n = \\frac{n}{2}\\left(2a + (n-1)d\\right)", plain: "Tₙ = a + (n − 1)d;  Sₙ = n/2 · (2a + (n − 1)d)" },
  { term: "Geometric sequence", topic: "Algebra", def: "Each term multiplies by a constant ratio r. The nth term and the sum of the first n terms (r ≠ 1):", tex: "T_n = ar^{n-1},\\quad S_n = \\frac{a(1 - r^n)}{1 - r}", plain: "Tₙ = a·rⁿ⁻¹;  Sₙ = a(1 − rⁿ)/(1 − r)" },
  { term: "Sum to infinity", topic: "Algebra", def: "The sum of an infinite geometric series, which converges only when |r| < 1.", tex: "S_\\infty = \\frac{a}{1 - r},\\quad |r| < 1", plain: "S∞ = a/(1 − r), for |r| < 1" },
  { term: "Binomial theorem", topic: "Algebra", def: "Expands a power of a sum.", tex: "(a + b)^n = \\sum_{k=0}^{n} \\binom{n}{k} a^{n-k} b^k", plain: "(a + b)ⁿ = Σ C(n,k)·aⁿ⁻ᵏ·bᵏ, k = 0…n" },
  // Functions & geometry
  { term: "Gradient (slope)", topic: "Functions", def: "How steep a straight line is: change in y over change in x.", tex: "m = \\frac{y_2 - y_1}{x_2 - x_1}", plain: "m = (y₂ − y₁)/(x₂ − x₁)" },
  { term: "Equation of a straight line", topic: "Functions", def: "A line with gradient m and y-intercept c, or through the point (x₁, y₁).", tex: "y = mx + c,\\quad y - y_1 = m(x - x_1)", plain: "y = mx + c;  y − y₁ = m(x − x₁)" },
  { term: "Distance formula", topic: "Geometry", def: "The length of the line between two points.", tex: "d = \\sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}", plain: "d = √((x₂ − x₁)² + (y₂ − y₁)²)" },
  { term: "Midpoint", topic: "Geometry", def: "The point halfway between two points.", tex: "M = \\left(\\frac{x_1 + x_2}{2}, \\frac{y_1 + y_2}{2}\\right)", plain: "M = ((x₁ + x₂)/2, (y₁ + y₂)/2)" },
  { term: "Pythagoras' theorem", topic: "Geometry", def: "In a right-angled triangle, the square of the hypotenuse equals the sum of the squares of the other two sides.", tex: "c^2 = a^2 + b^2", plain: "c² = a² + b²" },
  { term: "Area of a circle", topic: "Geometry", def: "Area and circumference of a circle with radius r.", tex: "A = \\pi r^2,\\quad C = 2\\pi r", plain: "A = πr²;  C = 2πr" },
  { term: "Equation of a circle", topic: "Geometry", def: "A circle with centre (a, b) and radius r.", tex: "(x - a)^2 + (y - b)^2 = r^2", plain: "(x − a)² + (y − b)² = r²" },
  // Trigonometry
  { term: "SOH CAH TOA", topic: "Trigonometry", def: "Trig ratios in a right-angled triangle.", tex: "\\sin\\theta = \\frac{\\text{opp}}{\\text{hyp}},\\ \\cos\\theta = \\frac{\\text{adj}}{\\text{hyp}},\\ \\tan\\theta = \\frac{\\text{opp}}{\\text{adj}}", plain: "sin θ = opp/hyp; cos θ = adj/hyp; tan θ = opp/adj", aka: ["trig ratios"] },
  { term: "Pythagorean identity", topic: "Trigonometry", def: "Holds for every angle θ.", tex: "\\sin^2\\theta + \\cos^2\\theta = 1", plain: "sin²θ + cos²θ = 1" },
  { term: "Sine rule", topic: "Trigonometry", def: "Relates sides to the sines of their opposite angles in any triangle.", tex: "\\frac{a}{\\sin A} = \\frac{b}{\\sin B} = \\frac{c}{\\sin C}", plain: "a/sin A = b/sin B = c/sin C" },
  { term: "Cosine rule", topic: "Trigonometry", def: "Finds a side or angle in any triangle when the sine rule can't.", tex: "a^2 = b^2 + c^2 - 2bc\\cos A", plain: "a² = b² + c² − 2bc·cos A" },
  { term: "Double-angle formulas", topic: "Trigonometry", def: "Express trig functions of 2θ in terms of θ.", tex: "\\sin 2\\theta = 2\\sin\\theta\\cos\\theta,\\quad \\cos 2\\theta = \\cos^2\\theta - \\sin^2\\theta", plain: "sin 2θ = 2 sin θ cos θ;  cos 2θ = cos²θ − sin²θ" },
  { term: "Radian", topic: "Trigonometry", def: "An angle measure: one full turn is 2π radians, so π radians is 180°.", tex: "\\pi \\text{ rad} = 180^\\circ", plain: "π rad = 180°" },
  // Calculus
  { term: "Derivative", topic: "Calculus", def: "The instantaneous rate of change of a function: the gradient of the tangent, defined as a limit.", tex: "f'(x) = \\lim_{h \\to 0} \\frac{f(x + h) - f(x)}{h}", plain: "f′(x) = lim(h→0) [f(x + h) − f(x)] / h", aka: ["differentiation", "first principles"] },
  { term: "Power rule", topic: "Calculus", def: "Differentiates a power of x.", tex: "\\frac{d}{dx}x^n = nx^{n-1}", plain: "d/dx (xⁿ) = n·xⁿ⁻¹", example: "d/dx (x³) = 3x²" },
  { term: "Product rule", topic: "Calculus", def: "Differentiates a product of two functions.", tex: "(uv)' = u'v + uv'", plain: "(uv)′ = u′v + uv′" },
  { term: "Quotient rule", topic: "Calculus", def: "Differentiates one function divided by another.", tex: "\\left(\\frac{u}{v}\\right)' = \\frac{u'v - uv'}{v^2}", plain: "(u/v)′ = (u′v − uv′)/v²" },
  { term: "Chain rule", topic: "Calculus", def: "Differentiates a function of a function.", tex: "\\frac{dy}{dx} = \\frac{dy}{du}\\cdot\\frac{du}{dx}", plain: "dy/dx = (dy/du)·(du/dx)", example: "d/dx (sin 3x) = 3 cos 3x" },
  { term: "Standard derivatives", topic: "Calculus", def: "Derivatives worth knowing by heart.", tex: "\\frac{d}{dx}e^x = e^x,\\ \\frac{d}{dx}\\ln x = \\frac{1}{x},\\ \\frac{d}{dx}\\sin x = \\cos x,\\ \\frac{d}{dx}\\cos x = -\\sin x", plain: "(eˣ)′ = eˣ; (ln x)′ = 1/x; (sin x)′ = cos x; (cos x)′ = −sin x" },
  { term: "Integral (antiderivative)", topic: "Calculus", def: "Reverses differentiation. For powers (n ≠ −1):", tex: "\\int x^n\\,dx = \\frac{x^{n+1}}{n+1} + C", plain: "∫ xⁿ dx = xⁿ⁺¹/(n + 1) + C, n ≠ −1", aka: ["integration"] },
  { term: "Fundamental theorem of calculus", topic: "Calculus", def: "A definite integral is the change in an antiderivative F between the limits.", tex: "\\int_a^b f(x)\\,dx = F(b) - F(a)", plain: "∫ₐᵇ f(x) dx = F(b) − F(a)" },
  { term: "Integration by parts", topic: "Calculus", def: "Integrates a product by moving the derivative from one factor to the other.", tex: "\\int u\\,dv = uv - \\int v\\,du", plain: "∫ u dv = uv − ∫ v du" },
  { term: "Limit", topic: "Calculus", def: "The value a function approaches as its input approaches a point.", tex: "\\lim_{x \\to a} f(x) = L", plain: "lim(x→a) f(x) = L" },
  { term: "Stationary point", topic: "Calculus", def: "Where the gradient is zero. Use the second derivative to classify it: f″ > 0 is a minimum, f″ < 0 a maximum.", tex: "f'(x) = 0", plain: "f′(x) = 0", aka: ["turning point", "critical point"] },
  // Statistics & probability
  { term: "Mean", topic: "Statistics", def: "The sum of the values divided by how many there are.", tex: "\\bar{x} = \\frac{1}{n}\\sum_{i=1}^{n} x_i", plain: "x̄ = (Σ xᵢ)/n", aka: ["average"] },
  { term: "Median", topic: "Statistics", def: "The middle value once the data is in order (the mean of the two middle values if n is even)." },
  { term: "Standard deviation", topic: "Statistics", def: "How spread out the data is around the mean. This is the sample version (divide by n − 1).", tex: "s = \\sqrt{\\frac{\\sum (x_i - \\bar{x})^2}{n - 1}}", plain: "s = √( Σ(xᵢ − x̄)² / (n − 1) )" },
  { term: "Variance", topic: "Statistics", def: "The square of the standard deviation.", tex: "s^2 = \\frac{\\sum (x_i - \\bar{x})^2}{n - 1}", plain: "s² = Σ(xᵢ − x̄)² / (n − 1)" },
  { term: "Z-score", topic: "Statistics", def: "How many standard deviations a value is from the mean.", tex: "z = \\frac{x - \\mu}{\\sigma}", plain: "z = (x − μ)/σ" },
  { term: "Probability rules", topic: "Probability", def: "Addition rule for 'A or B', and the multiplication rule for independent events.", tex: "P(A \\cup B) = P(A) + P(B) - P(A \\cap B),\\quad P(A \\cap B) = P(A)P(B)", plain: "P(A or B) = P(A) + P(B) − P(A and B);  independent: P(A and B) = P(A)·P(B)" },
  { term: "Conditional probability", topic: "Probability", def: "The probability of A given that B has happened.", tex: "P(A \\mid B) = \\frac{P(A \\cap B)}{P(B)}", plain: "P(A|B) = P(A and B)/P(B)" },
  { term: "Bayes' theorem", topic: "Probability", def: "Reverses a conditional probability.", tex: "P(A \\mid B) = \\frac{P(B \\mid A)\\,P(A)}{P(B)}", plain: "P(A|B) = P(B|A)·P(A)/P(B)" },
  { term: "Combinations and permutations", topic: "Probability", def: "Ways to choose r from n when order doesn't matter (combinations) or does (permutations).", tex: "\\binom{n}{r} = \\frac{n!}{r!(n-r)!},\\quad {}^nP_r = \\frac{n!}{(n-r)!}", plain: "C(n,r) = n!/(r!(n − r)!);  P(n,r) = n!/(n − r)!" },
  // Finance (common in first-year SA courses)
  { term: "Compound interest", topic: "Finance", def: "Growth when interest is added to the balance each period, at rate i per period for n periods.", tex: "A = P(1 + i)^n", plain: "A = P(1 + i)ⁿ" },
  { term: "Simple interest", topic: "Finance", def: "Interest on the original amount only.", tex: "A = P(1 + in)", plain: "A = P(1 + i·n)" },
];
